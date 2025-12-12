import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/bookings -> rider requests a ride
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { rideId, riderName, riderEmail } = body;

    if (!rideId || !riderName || !riderEmail) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      select: { id: true, status: true },
    });

    if (!ride || ride.status !== "OPEN") {
      return NextResponse.json(
        { ok: false, error: "Ride is not available" },
        { status: 400 }
      );
    }

    const booking = await prisma.booking.create({
      data: {
        rideId,
        riderName,
        riderEmail,
        status: "PENDING",
      },
    });

    return NextResponse.json({ ok: true, booking }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { ok: false, error: "Failed to create booking" },
      { status: 500 }
    );
  }
}
