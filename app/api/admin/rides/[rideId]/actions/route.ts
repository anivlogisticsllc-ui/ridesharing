// app/api/admin/rides/[rideId]/actions/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { PaymentType } from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

type Action = "MARK_CASH_NOT_PAID" | "REVOKE_CASH_DISCOUNT" | "CHARGE_FALLBACK_CARD";
type Body = { action?: Action; note?: string };

type Ctx = { params: { rideId: string } | Promise<{ rideId: string }> };

function toIsoOrNull(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

function shapeRideWithLatestBooking(ride: any) {
  const b = ride?.bookings?.[0] ?? null;

  return {
    ...ride,
    departureTime: toIsoOrNull(ride.departureTime),
    tripStartedAt: toIsoOrNull(ride.tripStartedAt),
    tripCompletedAt: toIsoOrNull(ride.tripCompletedAt),
    createdAt: toIsoOrNull(ride.createdAt),
    updatedAt: toIsoOrNull(ride.updatedAt),
    latestBooking: b
      ? {
          ...b,
          createdAt: toIsoOrNull(b.createdAt),
          updatedAt: toIsoOrNull(b.updatedAt),
          cashNotPaidAt: toIsoOrNull(b.cashNotPaidAt),
          cashDiscountRevokedAt: toIsoOrNull(b.cashDiscountRevokedAt),
          fallbackCardChargedAt: toIsoOrNull(b.fallbackCardChargedAt),
        }
      : null,
    bookings: undefined,
  };
}

function isOriginallyCash(b: any) {
  const orig = b?.originalPaymentType ?? null;
  const cur = b?.paymentType ?? null;
  return orig === PaymentType.CASH || cur === PaymentType.CASH;
}

function clampCents(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const adminId = (session?.user as any)?.id as string | undefined;
  const role = (session?.user as any)?.role as string | undefined;

  if (!session || !adminId) return jsonError(401, "Not authenticated");
  if (role !== "ADMIN") return jsonError(403, "Admin only");

  const params = await Promise.resolve(ctx.params);
  const rideId = decodeURIComponent(params?.rideId || "");
  if (!rideId) return jsonError(400, "Missing rideId");

  const body = (await req.json().catch(() => ({}))) as Body;
  const action = body.action;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";

  if (!action) return jsonError(400, "Missing action");

  // Load ride + latest booking (only the fields we need for decisions)
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    include: {
      driver: { select: { id: true, name: true, email: true, publicId: true } },
      rider: { select: { id: true, name: true, email: true } },
      bookings: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,

          paymentType: true,
          cashDiscountBps: true,

          originalPaymentType: true,
          originalCashDiscountBps: true,

          baseAmountCents: true,
          discountCents: true,
          finalAmountCents: true,
          currency: true,

          cashNotPaidAt: true,
          cashNotPaidByUserId: true,

          cashDiscountRevokedAt: true,
          cashDiscountRevokedReason: true,

          fallbackCardChargedAt: true,

          stripePaymentIntentId: true,
          stripePaymentIntentStatus: true,

          cashNotPaidNote: true,
          cashNotPaidReportedById: true,

          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!ride) return jsonError(404, "Ride not found");

  const booking = ride.bookings?.[0];
  if (!booking) return jsonError(400, "No booking exists for this ride");

  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      if (action === "MARK_CASH_NOT_PAID") {
        if (!isOriginallyCash(booking)) {
          throw new Error("This booking is not a CASH-intent booking.");
        }

        // This is an admin “confirmation” step.
        // Don’t overwrite driver report fields if present.
        const mergedNote =
          note && !booking.cashNotPaidNote
            ? note
            : note && booking.cashNotPaidNote
              ? `${booking.cashNotPaidNote}\nADMIN: ${note}`
              : undefined;

        await tx.booking.update({
          where: { id: booking.id },
          data: {
            cashNotPaidAt: booking.cashNotPaidAt ?? now,
            cashNotPaidByUserId: booking.cashNotPaidByUserId ?? adminId,
            ...(mergedNote ? { cashNotPaidNote: mergedNote } : {}),
          },
        });

        return;
      }

      if (action === "REVOKE_CASH_DISCOUNT") {
        if (!isOriginallyCash(booking)) {
          throw new Error("This booking is not a CASH-intent booking.");
        }

        // Idempotent: if already revoked, do nothing.
        const revokeReason =
          booking.cashDiscountRevokedReason ??
          (note ? note : "Cash discount revoked (admin). Rider did not pay cash.");

        const base = clampCents(booking.baseAmountCents);
        // After revoke, discount goes to 0 and final equals base
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            cashDiscountRevokedAt: booking.cashDiscountRevokedAt ?? now,
            cashDiscountRevokedReason: revokeReason,

            // Align state with “no cash discount”
            cashDiscountBps: 0,
            discountCents: 0,
            finalAmountCents: base || booking.finalAmountCents || booking.baseAmountCents || 0,

            // In your system, once revoked we treat it as CARD-resolvable.
            paymentType: PaymentType.CARD,
          },
        });

        return;
      }

      if (action === "CHARGE_FALLBACK_CARD") {
        // With your current flow, driver/report-unpaid already charges and sets these.
        // So this action is basically a “safety retry” and should be blocked if already charged.
        if (booking.fallbackCardChargedAt || booking.stripePaymentIntentStatus === "succeeded") {
          throw new Error("Fallback card is already charged.");
        }

        // If you want admin to actually do Stripe charging here,
        // we need to import stripe and create/confirm a PaymentIntent.
        // For now, fail fast with a clear message.
        throw new Error(
          "Admin fallback charge is not implemented. Use driver 'report unpaid' flow or implement Stripe charge in this route."
        );
      }

      const _never: never = action;
      void _never;
    });
  } catch (e: any) {
    return jsonError(400, e?.message || "Failed to apply action");
  }

  const refreshed = await prisma.ride.findUnique({
    where: { id: rideId },
    include: {
      driver: { select: { id: true, name: true, email: true, publicId: true } },
      rider: { select: { id: true, name: true, email: true } },
      bookings: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          paymentType: true,
          cashDiscountBps: true,
          originalPaymentType: true,
          originalCashDiscountBps: true,
          baseAmountCents: true,
          discountCents: true,
          finalAmountCents: true,
          currency: true,
          cashNotPaidAt: true,
          cashNotPaidByUserId: true,
          cashDiscountRevokedAt: true,
          cashDiscountRevokedReason: true,
          fallbackCardChargedAt: true,
          stripePaymentIntentId: true,
          stripePaymentIntentStatus: true,
          cashNotPaidNote: true,
          cashNotPaidReportedById: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!refreshed) return jsonError(404, "Ride not found");

  return NextResponse.json({ ok: true, ride: shapeRideWithLatestBooking(refreshed) }, { headers: { "Cache-Control": "no-store" } });
}