// app/api/billing/authorize-booking/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { BookingStatus, PaymentType, RidePaymentStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    details ? { ok: false, error, details } : { ok: false, error },
    { status }
  );
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

function mapStripeStatusToRidePaymentStatus(stripeStatus: string): RidePaymentStatus {
  if (stripeStatus === "requires_capture") return RidePaymentStatus.AUTHORIZED;
  if (stripeStatus === "succeeded") return RidePaymentStatus.SUCCEEDED;
  if (stripeStatus === "canceled") return RidePaymentStatus.FAILED;
  return RidePaymentStatus.PENDING;
}

// Buffer: 25%, min $2, max $20 (tune later)
function computeBufferCents(estimateCents: number) {
  const bufferPct = 0.25;
  const minBufferCents = 200;
  const maxBufferCents = 2000;

  const computed = Math.round(estimateCents * bufferPct);
  return Math.min(maxBufferCents, Math.max(minBufferCents, computed));
}

export async function POST(req: Request) {
  const auth = await requireDriverOrAdmin();
  if (!auth) return jsonError(401, "Not authenticated");

  const body = (await req.json().catch(() => null)) as { bookingId?: string } | null;
  const bookingId = String(body?.bookingId || "").trim();
  if (!bookingId) return jsonError(400, "Missing bookingId");

  // Load booking + ride + rider
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      paymentType: true,
      finalAmountCents: true,
      currency: true,
      riderId: true,
      rideId: true,
      ride: { select: { driverId: true, totalPriceCents: true } },
      rider: {
        select: {
          id: true,
          stripeCustomerId: true,
          stripeDefaultPaymentId: true,
          paymentMethods: {
            where: { isDefault: true },
            orderBy: { updatedAt: "desc" },
            select: { id: true, stripePaymentMethodId: true },
            take: 1,
          },
        },
      },
    },
  });

  if (!booking) return jsonError(404, "Booking not found");

  // Only driver who accepted (or admin)
  if (!auth.isAdmin && booking.ride.driverId !== auth.userId) return jsonError(403, "Forbidden");

  if (booking.status !== BookingStatus.ACCEPTED) {
    return jsonError(400, `Cannot authorize for booking status ${booking.status}`);
  }

  if (booking.paymentType !== PaymentType.CARD) {
    return jsonError(400, "Booking paymentType is not CARD");
  }

  // Estimate: prefer booking snapshot; fallback to ride.totalPriceCents
  const estimateCents =
    typeof booking.finalAmountCents === "number" && booking.finalAmountCents > 0
      ? booking.finalAmountCents
      : booking.ride.totalPriceCents ?? 0;

  if (!Number.isFinite(estimateCents) || estimateCents < 50) {
    return jsonError(400, "Invalid estimated amount for authorization.");
  }

  const bufferCents = computeBufferCents(estimateCents);
  const authorizedCents = estimateCents + bufferCents;

  const rider = booking.rider;
  if (!rider?.stripeCustomerId) {
    return jsonError(400, "Rider has no Stripe customer. Add a payment method first.");
  }

  const defaultPm =
    rider.paymentMethods?.[0]?.stripePaymentMethodId ||
    rider.stripeDefaultPaymentId ||
    null;

  if (!defaultPm) {
    return jsonError(400, "No default payment method found for rider.");
  }

  // Idempotency per RIDE
  const idempotencyKey = `ride_auth_${booking.rideId}`;

  // If already authorized for this ride and not captured, reuse it
  const existing = await prisma.ridePayment.findFirst({
    where: {
      rideId: booking.rideId,
      paymentType: PaymentType.CARD,
      stripePaymentIntentId: { not: null },
      capturedAt: null,
      status: { in: [RidePaymentStatus.AUTHORIZED, RidePaymentStatus.PENDING] },
      idempotencyKey,
    },
    orderBy: { createdAt: "desc" },
    select: { stripePaymentIntentId: true, status: true, amountCents: true, finalAmountCents: true },
  });

  if (existing?.stripePaymentIntentId) {
    return NextResponse.json({
      ok: true,
      reused: true,
      paymentIntentId: existing.stripePaymentIntentId,
      status: existing.status,
      authorizedAmountCents: existing.amountCents,
      estimatedAmountCents: existing.finalAmountCents,
    });
  }

  const stripeCurrency = (process.env.STRIPE_CURRENCY || "usd").toLowerCase();

  let pi;
  try {
    pi = await stripe.paymentIntents.create(
      {
        amount: authorizedCents, // ✅ authorize buffered amount
        currency: stripeCurrency,
        customer: rider.stripeCustomerId,
        payment_method: defaultPm,
        capture_method: "manual",
        confirm: true,
        off_session: true,
        metadata: {
          bookingId: booking.id,
          rideId: booking.rideId,
          riderId: booking.riderId || "",
          kind: "ride_authorization",
          estimatedCents: String(estimateCents),
          authorizedCents: String(authorizedCents),
          bufferCents: String(bufferCents),
        },
      },
      { idempotencyKey }
    );
  } catch (e: any) {
    return jsonError(400, "Stripe authorization failed", { message: e?.message || String(e) });
  }

  const mappedStatus = mapStripeStatusToRidePaymentStatus(pi.status);

  const base = booking.ride.totalPriceCents ?? estimateCents;
  const discount = Math.max(0, base - estimateCents);

  await prisma.ridePayment.create({
    data: {
      rideId: booking.rideId,
      riderId: booking.riderId!, // expected in your flow

      // ✅ store both (Option 1)
      amountCents: authorizedCents,     // authorized (estimate + buffer)
      finalAmountCents: estimateCents,  // estimated final (will overwrite at capture with actual)
      currency: stripeCurrency,

      provider: "STRIPE",
      status: mappedStatus,
      authorizedAt: mappedStatus === RidePaymentStatus.AUTHORIZED ? new Date() : null,

      baseAmountCents: base,
      discountCents: discount,

      idempotencyKey,
      paymentType: PaymentType.CARD,

      stripeCustomerId: rider.stripeCustomerId,
      stripePaymentIntentId: pi.id,

      // store the PaymentMethod row id if we have it
      paymentMethodId: rider.paymentMethods?.[0]?.id ?? null,
    },
  });

  // convenience stamp on booking
  if (rider.paymentMethods?.[0]?.id) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { paymentMethodId: rider.paymentMethods[0].id },
    });
  }

  return NextResponse.json({
    ok: true,
    paymentIntentId: pi.id,
    stripeStatus: pi.status,
    capturable: pi.status === "requires_capture",
    estimatedAmountCents: estimateCents,
    authorizedAmountCents: authorizedCents,
    bufferCents,
  });
}
