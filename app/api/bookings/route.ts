// app/api/bookings/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { BookingStatus } from "@prisma/client";

// POST /api/bookings -> rider requests a ride
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { rideId } = body as { rideId?: string };

    if (!rideId) {
      return NextResponse.json(
        { ok: false, error: "rideId is required" },
        { status: 400 }
      );
    }

    // Get logged-in rider
    const session = await getServerSession(authOptions);
    const user = session?.user as { id?: string } | null | undefined;
    const userId = user?.id;

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    // Ensure ride exists and is OPEN
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

    // Create booking tied to this rider
    const booking = await prisma.booking.create({
      data: {
        rideId,
        riderId: userId,
        status: BookingStatus.PENDING,
      },
    });

    return NextResponse.json({ ok: true, booking }, { status: 201 });
  } catch (err) {
    console.error("Error creating booking:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to create booking" },
      { status: 500 }
    );
  }
}
