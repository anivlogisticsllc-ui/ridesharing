// app/api/bookings/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { BookingStatus } from "@prisma/client";

type Body = {
  rideId?: string;
  riderName?: string;
  riderEmail?: string;
};

// Extend NextAuth's session user shape locally
type SessionUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: "RIDER" | "DRIVER" | "BOTH";
};

export async function POST(req: Request) {
  try {
    // 1) Logged-in user
    const session = await getServerSession(authOptions);
    const user = session?.user as SessionUser | undefined;
    const userId = user?.id;

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    // 2) Request body
    const { rideId, riderName, riderEmail } = (await req.json()) as Body;

    if (!rideId || !riderName || !riderEmail) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    // 3) Ensure ride exists and is OPEN
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

    // 4) Create booking tied to this rider
    const booking = await prisma.booking.create({
      data: {
        riderName,
        riderEmail,
        status: BookingStatus.PENDING,
        ride: {
          connect: { id: rideId },
        },
        rider: {
          connect: { id: userId },
        },
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
