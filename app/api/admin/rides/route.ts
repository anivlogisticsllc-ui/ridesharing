// app/api/admin/rides/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role as string | undefined;

  if (!session) return jsonError(401, "Not authenticated");
  if (role !== "ADMIN") return jsonError(403, "Admin only");

  const rides = await prisma.ride.findMany({
    orderBy: { updatedAt: "desc" },
    take: 300,
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

          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  const shaped = rides.map((r) => {
    const b = (r as any).bookings?.[0] ?? null;

    return {
      id: r.id,
      status: r.status,

      originCity: r.originCity,
      destinationCity: r.destinationCity,
      departureTime: r.departureTime?.toISOString?.() ?? null,

      tripStartedAt: r.tripStartedAt?.toISOString?.() ?? null,
      tripCompletedAt: r.tripCompletedAt?.toISOString?.() ?? null,

      distanceMiles: r.distanceMiles ?? null,
      passengerCount: r.passengerCount ?? null,
      totalPriceCents: r.totalPriceCents ?? null,

      createdAt: r.createdAt?.toISOString?.() ?? null,
      updatedAt: r.updatedAt?.toISOString?.() ?? null,

      rider: r.rider ?? null,
      driver: r.driver ?? null,

      latestBooking: b
        ? {
            ...b,
            createdAt: b.createdAt?.toISOString?.() ?? null,
            updatedAt: b.updatedAt?.toISOString?.() ?? null,
            cashNotPaidAt: b.cashNotPaidAt?.toISOString?.() ?? null,
            cashDiscountRevokedAt: b.cashDiscountRevokedAt?.toISOString?.() ?? null,
            fallbackCardChargedAt: b.fallbackCardChargedAt?.toISOString?.() ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({ ok: true, rides: shaped }, { headers: { "Cache-Control": "no-store" } });
}