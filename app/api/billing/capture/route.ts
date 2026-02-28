// app/api/billing/capture/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import {
  BookingStatus,
  PaymentType,
  RidePaymentStatus,
  RideStatus,
} from "@prisma/client";

export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    details ? { ok: false, error, details } : { ok: false, error },
    { status }
  );
}

function clampPositiveInt(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n > 0 ? n : null;
}

async function requireDriverOrAdmin() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const role = (session?.user as any)?.role as string | undefined;
  const isAdmin = Boolean((session?.user as any)?.isAdmin);

  if (!userId) return null;
  if (role === "DRIVER" || role === "ADMIN" || isAdmin) return { userId, role, isAdmin };
  return null;
}

export async function POST(req: Request) {
  const auth = await requireDriverOrAdmin();
  if (!auth) return jsonError(401, "Not authenticated");

  const body = (await req.json().catch(() => null)) as
    | { rideId?: string; finalAmountCents?: number | null }
    | null;

  const rideId = String(body?.rideId || "").trim();
  if (!rideId) return jsonError(400, "Missing rideId");

  // Verify ride + permission
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    select: { id: true, driverId: true, status: true, totalPriceCents: true },
  });
  if (!ride) return jsonError(404, "Ride not found");
  if (!auth.isAdmin && ride.driverId !== auth.userId) return jsonError(403, "Forbidden");

  // Must be completed
  if (ride.status !== RideStatus.COMPLETED) {
    return jsonError(400, `Ride must be COMPLETED to capture (current: ${ride.status})`);
  }

  // Load the relevant booking to decide policy (CARD vs CASH fallback)
  const booking = await prisma.booking.findFirst({
    where: {
      rideId,
      status: { in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      paymentType: true,
      baseAmountCents: true,
      finalAmountCents: true,
      discountCents: true,
      cashDiscountBps: true,
    },
  });

  if (!booking) {
    return jsonError(400, "No booking found for this ride to determine capture policy.");
  }

  // Find the latest uncaptured authorization for this ride
  const rp = await prisma.ridePayment.findFirst({
    where: {
      rideId,
      stripePaymentIntentId: { not: null },
      capturedAt: null,
      status: { in: [RidePaymentStatus.AUTHORIZED, RidePaymentStatus.PENDING] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      stripePaymentIntentId: true,
      amountCents: true,       // authorized amount (with buffer)
      finalAmountCents: true,  // last known estimate
      baseAmountCents: true,
      discountCents: true,
    },
  });

  if (!rp?.stripePaymentIntentId) {
    return jsonError(400, "No authorized payment found for this ride.");
  }

  // ----------------------------
  // CAPTURE POLICY
  // ----------------------------
  // CARD rides: capture requested final (prefer body.finalAmountCents, else ride.totalPriceCents, else rp.finalAmountCents)
  //
  // CASH fallback: capture base fare ONLY (revert discount), no fee, no tip.
  // We treat booking.paymentType === CASH as a fallback capture event.
  const isCashFallback = booking.paymentType === PaymentType.CASH;

  let amountToCapture: number | null = null;

  if (isCashFallback) {
    // Revert the 10% discount by charging the base (non-discounted) fare.
    // Prefer booking.baseAmountCents; fallback to ride.totalPriceCents; last resort rp.baseAmountCents.
    amountToCapture =
      clampPositiveInt(booking.baseAmountCents) ??
      clampPositiveInt(ride.totalPriceCents) ??
      clampPositiveInt(rp.baseAmountCents) ??
      null;
  } else {
    // Normal CARD capture
    amountToCapture =
      clampPositiveInt(body?.finalAmountCents) ??
      clampPositiveInt(ride.totalPriceCents) ??
      clampPositiveInt(rp.finalAmountCents) ??
      null;
  }

  if (!amountToCapture || amountToCapture < 50) {
    return jsonError(400, "Missing/invalid finalAmountCents to capture.", {
      isCashFallback,
      computed: amountToCapture,
    });
  }

  // Stripe rule: capture <= authorized amount
  if (amountToCapture > rp.amountCents) {
    return jsonError(400, "Final amount exceeds authorized amount. Increase buffer or re-authorize.", {
      requestedFinal: amountToCapture,
      authorized: rp.amountCents,
      isCashFallback,
    });
  }

  let pi;
  try {
    pi = await stripe.paymentIntents.capture(rp.stripePaymentIntentId, {
      amount_to_capture: amountToCapture,
    });
  } catch (e: any) {
    await prisma.ridePayment.update({
      where: { id: rp.id },
      data: { status: RidePaymentStatus.FAILED, failedAt: new Date() } as any,
    });
    return jsonError(400, "Stripe capture failed", { message: e?.message || String(e) });
  }

  const succeeded = pi.status === "succeeded";

  await prisma.ridePayment.update({
    where: { id: rp.id },
    data: {
      status: succeeded ? RidePaymentStatus.SUCCEEDED : RidePaymentStatus.PENDING,
      capturedAt: succeeded ? new Date() : null,
      // Store the actual captured amount
      finalAmountCents: amountToCapture,

      // Optional: for cash fallback, ensure discount is effectively treated as zero at the payment record level
      ...(isCashFallback
        ? {
            discountCents: 0,
            baseAmountCents: clampPositiveInt(booking.baseAmountCents) ?? clampPositiveInt(ride.totalPriceCents) ?? 0,
          }
        : {}),
    } as any,
  });

  return NextResponse.json({
    ok: true,
    stripeStatus: pi.status,
    capturedAmountCents: amountToCapture,
    policy: isCashFallback ? "CASH_FALLBACK_NO_DISCOUNT_NO_TIP_NO_FEE" : "CARD_CAPTURE",
  });
}