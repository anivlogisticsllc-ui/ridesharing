import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

type SessionUser = {
  id?: string | null;
};

export async function GET(req: NextRequest) {
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
        riderId,
      },
      include: {
        ride: {
          include: {
            driver: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!booking || !booking.ride) {
      return NextResponse.json(
        { ok: false, error: "Charge details not found." },
        { status: 404 }
      );
    }

    const dispute = await prisma.dispute.findFirst({
      where: {
        bookingId,
        riderId,
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
    console.error("[GET /api/rider/disputes/details] error:", error);

    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
