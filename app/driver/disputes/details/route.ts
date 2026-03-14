// OATH: Clean replacement file
// FILE: app/api/driver/disputes/details/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { UserRole } from "@prisma/client";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

type SessionUser = {
  id?: string | null;
  role?: UserRole | string | null;
};

export async function GET(req: NextRequest) {
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
        { ok: false, error: "Only drivers can access this dispute view." },
        { status: 403 }
      );
    }

    const bookingId = req.nextUrl.searchParams.get("bookingId")?.trim();
    if (!bookingId) {
      return NextResponse.json(
        { ok: false, error: "Missing bookingId" },
        { status: 400 }
      );
    }

    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        ride: {
          driverId,
        },
      },
      include: {
        rider: {
          select: {
            id: true,
            name: true,
          },
        },
        ride: {
          include: {
            driver: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!booking || !booking.ride) {
      return NextResponse.json(
        { ok: false, error: "Dispute details not found." },
        { status: 404 }
      );
    }

    const dispute = await prisma.dispute.findFirst({
      where: {
        bookingId: booking.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        status: true,
        reason: true,
        riderStatement: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      ok: true,
      booking: {
        id: booking.id,
        paymentType: booking.paymentType ?? null,
        cashNotPaidAt: booking.cashNotPaidAt
          ? booking.cashNotPaidAt.toISOString()
          : null,
        fallbackCardChargedAt: booking.fallbackCardChargedAt
          ? booking.fallbackCardChargedAt.toISOString()
          : null,
        cashNotPaidReason: booking.cashNotPaidReason ?? null,
        cashNotPaidNote: booking.cashNotPaidNote ?? null,
        baseAmountCents: booking.baseAmountCents ?? null,
        finalAmountCents: booking.finalAmountCents ?? null,
        currency: booking.currency ?? "USD",
      },
      ride: {
        id: booking.ride.id,
        originCity: booking.ride.originCity ?? "",
        destinationCity: booking.ride.destinationCity ?? "",
        departureTime: booking.ride.departureTime
          ? booking.ride.departureTime.toISOString()
          : "",
        tripCompletedAt: booking.ride.tripCompletedAt
          ? booking.ride.tripCompletedAt.toISOString()
          : null,
        status: booking.ride.status,
        riderName: booking.rider?.name ?? booking.riderName ?? null,
        driverName: booking.ride.driver?.name ?? null,
      },
      dispute: dispute
        ? {
            id: dispute.id,
            status: dispute.status,
            reason: dispute.reason,
            riderStatement: dispute.riderStatement,
            createdAt: dispute.createdAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    console.error("[GET /api/driver/disputes/details] error:", error);

    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
