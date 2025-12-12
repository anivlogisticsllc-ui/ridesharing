// app/api/dev/seed/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    // Demo driver
    const driver = await prisma.user.upsert({
      where: { email: "driver@example.com" },
      update: {},
      create: {
        email: "driver@example.com",
        name: "Demo Driver",
        role: "DRIVER",
        passwordHash: "DEV_ONLY", // placeholder, real auth later
        phone: "555-000-0001",
        bio: "This is a demo driver account used for development only.",
        isVerifiedDriver: true,
      },
    });

    // Demo rider
    const rider = await prisma.user.upsert({
      where: { email: "rider@example.com" },
      update: {},
      create: {
        email: "rider@example.com",
        name: "Demo Rider",
        role: "RIDER",
        passwordHash: "DEV_ONLY",
        phone: "555-000-0002",
        bio: "This is a demo rider account used for development only.",
      },
    });

    // Create a sample ride (if none exists)
    const existingRide = await prisma.ride.findFirst({
      where: { driverId: driver.id },
    });

    let ride = existingRide;
    if (!ride) {
      ride = await prisma.ride.create({
        data: {
          driverId: driver.id,
          originCity: "San Francisco, CA",
          originLat: 37.7749,
          originLng: -122.4194,
          destinationCity: "San Jose, CA",
          destinationLat: 37.3382,
          destinationLng: -121.8863,
          departureTime: new Date(Date.now() + 2 * 60 * 60 * 1000), // in 2 hours
          distanceMiles: 40,
          status: "OPEN",
          // 👆 keep this object strictly to fields that exist on your Ride model
        },
      });
    }

    return NextResponse.json({
      ok: true,
      driver,
      rider,
      ride,
    });
  } catch (err) {
    console.error("GET /api/dev/seed error:", err);
    return NextResponse.json(
      { ok: false, error: "Seeding failed" },
      { status: 500 },
    );
  }
}
