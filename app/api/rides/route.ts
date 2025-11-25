// app/api/rides/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/rides -> list rides
export async function GET() {
  try {
    const rides = await prisma.ride.findMany({
      orderBy: { departureTime: "asc" },
      take: 20,
      include: {
        driver: {
          select: {
            name: true,
            ratingAverage: true,
            ratingCount: true,
            isVerifiedDriver: true,
          },
        },
      },
    });

    return NextResponse.json({ ok: true, rides });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { ok: false, error: "Could not fetch rides" },
      { status: 500 }
    );
  }
}

// POST /api/rides -> create a new ride
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      originCity,
      destinationCity,
      distanceMiles,
      departureTime, // ISO string
      availableSeats,
    } = body;

    if (
      !originCity ||
      !destinationCity ||
      distanceMiles == null ||
      !departureTime ||
      availableSeats == null
    ) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const distance = Number(distanceMiles);
    const seats = Number(availableSeats);

    if (Number.isNaN(distance) || distance <= 0) {
      return NextResponse.json(
        { ok: false, error: "distanceMiles must be a positive number" },
        { status: 400 }
      );
    }

    if (!Number.isInteger(seats) || seats <= 0) {
      return NextResponse.json(
        { ok: false, error: "availableSeats must be a positive integer" },
        { status: 400 }
      );
    }

    // For now, always use the demo driver (auth later)
    const driver = await prisma.user.upsert({
      where: { email: "driver@example.com" },
      update: {},
      create: {
        email: "driver@example.com",
        name: "Demo Driver",
        role: "DRIVER",
        passwordHash: "DEV_ONLY",
        phone: "555-000-0001",
        bio: "Demo driver used for development.",
        isVerifiedDriver: true,
      },
    });

    // Per-ride pricing: $3 booking + $2/mile
    const baseFareCents = 3 * 100;
    const distanceFareCents = Math.round(distance * 2 * 100);
    const totalPriceCents = baseFareCents + distanceFareCents;

    const ride = await prisma.ride.create({
      data: {
        driverId: driver.id,
        originCity,
        originLat: 0,
        originLng: 0,
        destinationCity,
        destinationLat: 0,
        destinationLng: 0,
        departureTime: new Date(departureTime),
        availableSeats: seats,
        distanceMiles: distance,
        // NOTE: using pricePerSeatCents column to store total per-ride price
        pricePerSeatCents: totalPriceCents,
        status: "OPEN",
      },
    });

    return NextResponse.json({ ok: true, ride }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { ok: false, error: "Failed to create ride" },
      { status: 500 }
    );
  }
}
