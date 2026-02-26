// app/api/billing/capture/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { RidePaymentStatus, RideStatus, UserRole } from "@prisma/client";

export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(details ? { ok: false, error, details } : { ok: false, error }, { status });
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

  const body = (await req.json().catch(() => null)) as { rideId?: string; finalAmountCents?: number | null } | null;
  const rideId = String(body?.rideId || "").trim();
  if (!rideId) return jsonError(400, "Missing rideId");

  // Verify ride + permission
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    select: { id: true, driverId: true, status: true, totalPriceCents: true },
  });
  if (!ride) return jsonError(404, "Ride not found");

  if (!auth.isAdmin && ride.driverId !== auth.userId) return jsonError(403, "Forbidden");

  // Must be completed (or allow capture right after completed)
  if (ride.status !== RideStatus.COMPLETED) {
    return jsonError(400, `Ride must be COMPLETED to capture (current: ${ride.status})`);
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
      amountCents: true,        // authorized
      finalAmountCents: true,   // estimated
    },
  });

  if (!rp?.stripePaymentIntentId) {
    return jsonError(400, "No authorized payment found for this ride.");
  }

  // Determine what to capture:
  // Prefer body.finalAmountCents (computed from actual miles), else ride.totalPriceCents, else rp.finalAmountCents
  const requestedFinal =
    typeof body?.finalAmountCents === "number" && body.finalAmountCents > 0
      ? body.finalAmountCents
      : typeof ride.totalPriceCents === "number" && ride.totalPriceCents > 0
      ? ride.totalPriceCents
      : typeof rp.finalAmountCents === "number" && rp.finalAmountCents > 0
      ? rp.finalAmountCents
      : null;

  if (!requestedFinal || requestedFinal < 50) {
    return jsonError(400, "Missing/invalid finalAmountCents to capture.");
  }

  // Stripe rule: capture <= authorized amount
  if (requestedFinal > rp.amountCents) {
    return jsonError(400, "Final fare exceeds authorized amount. Increase buffer or re-authorize.", {
      requestedFinal,
      authorized: rp.amountCents,
    });
  }

  let pi;
  try {
    // capture a specific amount
    pi = await stripe.paymentIntents.capture(rp.stripePaymentIntentId, { amount_to_capture: requestedFinal });
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
      // ✅ now finalAmountCents becomes actual captured amount
      finalAmountCents: requestedFinal,
    } as any,
  });

  return NextResponse.json({ ok: true, stripeStatus: pi.status, capturedAmountCents: requestedFinal });
}
