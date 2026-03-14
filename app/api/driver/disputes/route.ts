// OATH: Clean replacement file
// FILE: app/api/driver/disputes/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { UserRole } from "@prisma/client";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

type SessionUser = {
  id?: string | null;
  role?: UserRole | string | null;
};

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as SessionUser | undefined;

    const driverId = typeof user?.id === "string" ? user.id.trim() : "";
    if (!driverId) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    if (user?.role !== UserRole.DRIVER) {
      return NextResponse.json(
        { ok: false, error: "Only drivers can access driver disputes." },
        { status: 403 }
      );
    }

    const disputes = await prisma.dispute.findMany({
      where: {
        driverId,
      },
      orderBy: {
        createdAt: "desc",
      },
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
            riderName: true,
            rider: {
              select: {
                name: true,
              },
            },
            ride: {
              select: {
                originCity: true,
                destinationCity: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      disputes: disputes.map((item) => ({
        bookingId: item.bookingId,
        rideId: item.rideId,
        routeLabel: item.booking?.ride
          ? `${item.booking.ride.originCity} → ${item.booking.ride.destinationCity}`
          : "Unknown route",
        amountCents: item.booking?.finalAmountCents ?? null,
        currency: item.booking?.currency ?? "USD",
        riderName: item.booking?.rider?.name ?? item.booking?.riderName ?? null,
        driverReportedReason: item.booking?.cashNotPaidReason ?? null,
        fallbackCardChargedAt: item.booking?.fallbackCardChargedAt
          ? item.booking.fallbackCardChargedAt.toISOString()
          : null,
        riderDisputedAt: item.createdAt.toISOString(),
        disputeStatus: item.status,
      })),
    });
  } catch (error) {
    console.error("[GET /api/driver/disputes] error:", error);

    return NextResponse.json(
      { ok: false, error: "Failed to load driver disputes." },
      { status: 500 }
    );
  }
}
