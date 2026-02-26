// app/driver/complete-ride/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { BookingStatus, UserRole } from "@prisma/client";

type CompleteRideBody = {
  rideId?: string;
  elapsedSeconds?: number | null;
  distanceMiles?: number | null;
  fareCents?: number | null; // meter-computed final fare
};

function asInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as any;

    const userId = typeof user?.id === "string" ? user.id : null;
    const role = user?.role;

    if (!userId) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }
    if (role !== UserRole.DRIVER && role !== "DRIVER") {
      return NextResponse.json({ ok: false, error: "Only drivers can complete rides." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as CompleteRideBody;
    const rideId = typeof body.rideId === "string" ? body.rideId.trim() : "";

    if (!rideId) {
      return NextResponse.json({ ok: false, error: "Missing rideId" }, { status: 400 });
    }

    const distanceMiles = asInt(body.distanceMiles);
    const fareCents = asInt(body.fareCents);

    // Load the ride + most relevant booking
    const ride = await prisma.ride.findFirst({
      where: { id: rideId, driverId: userId },
      select: {
        id: true,
        driverId: true,
        status: true,
        tripStartedAt: true,
        tripCompletedAt: true,
        bookings: {
          where: { status: { in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true },
        },
      },
    });

    if (!ride) {
      return NextResponse.json({ ok: false, error: "Ride not found" }, { status: 404 });
    }

    // Don’t allow completing from invalid states
    if (ride.status !== "ACCEPTED" && ride.status !== "IN_ROUTE") {
      return NextResponse.json(
        { ok: false, error: `Ride cannot be completed from status ${ride.status}.` },
        { status: 400 }
      );
    }

    const booking = ride.bookings?.[0] ?? null;
    if (!booking) {
      return NextResponse.json({ ok: false, error: "Booking not found for this ride." }, { status: 400 });
    }

    const tripCompletedAt = new Date();

    await prisma.$transaction(async (tx) => {
      // Update ride
      await tx.ride.update({
        where: { id: rideId },
        data: {
          status: "COMPLETED",
          tripStartedAt: ride.tripStartedAt ?? undefined, // preserve if already set
          tripCompletedAt,
          distanceMiles: typeof distanceMiles === "number" ? distanceMiles : undefined,
        },
      });

      // Update booking to COMPLETED and store meter fare as finalAmountCents (if provided)
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.COMPLETED,
          finalAmountCents: typeof fareCents === "number" ? fareCents : undefined,
        },
      });
    });

    return NextResponse.json({ ok: true, tripCompletedAt: tripCompletedAt.toISOString() }, { status: 200 });
  } catch (err) {
    console.error("POST /api/driver/complete-ride error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
