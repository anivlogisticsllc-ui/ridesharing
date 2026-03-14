// OATH: Clean file
// FILE: app/api/rider/disputes/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

type SessionUser = {
  id?: string | null;
};

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as SessionUser | undefined;

    const riderId = user?.id?.trim();

    if (!riderId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const disputes = await prisma.dispute.findMany({
      where: { riderId },
      orderBy: { createdAt: "desc" },
      select: {
        bookingId: true,
        rideId: true,
        status: true,
        createdAt: true,
        booking: {
          select: {
            finalAmountCents: true,
            currency: true,
            fallbackCardChargedAt: true,
            cashNotPaidReason: true,
            ride: {
              select: {
                originCity: true,
                destinationCity: true,
                driver: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      disputes: disputes.map((d) => ({
        bookingId: d.bookingId,
        rideId: d.rideId,
        disputeStatus: d.status,
        riderDisputedAt: d.createdAt.toISOString(),
        routeLabel: d.booking?.ride
          ? `${d.booking.ride.originCity} → ${d.booking.ride.destinationCity}`
          : "Unknown route",
        driverName: d.booking?.ride?.driver?.name ?? null,
        amountCents: d.booking?.finalAmountCents ?? null,
        currency: d.booking?.currency ?? "USD",
        driverReportedReason: d.booking?.cashNotPaidReason ?? null,
        fallbackCardChargedAt: d.booking?.fallbackCardChargedAt
          ? d.booking.fallbackCardChargedAt.toISOString()
          : null,
      })),
    });
  } catch (error) {
    console.error("[GET /api/rider/disputes] error:", error);

    return NextResponse.json(
      { ok: false, error: "Failed to load disputes." },
      { status: 500 }
    );
  }
}
