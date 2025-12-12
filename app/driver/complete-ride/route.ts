// app/driver/complete-ride/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

type CompleteRideBody = {
  rideId?: string;
  elapsedSeconds?: number | null;
  distanceMiles?: number | null;
  fareCents?: number | null;
};

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const body = (await req.json()) as CompleteRideBody;
    const { rideId, elapsedSeconds, distanceMiles, fareCents } = body;

    if (!rideId) {
      return NextResponse.json(
        { ok: false, error: "Missing rideId" },
        { status: 400 }
      );
    }

    // Make sure this ride belongs to the current driver
    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      select: {
        id: true,
        driverId: true,
        status: true,
        tripStartedAt: true,
      },
    });

    if (!ride || ride.driverId !== userId) {
      return NextResponse.json(
        { ok: false, error: "Ride not found" },
        { status: 404 }
      );
    }

    const tripCompletedAt = new Date();

    await prisma.ride.update({
      where: { id: rideId },
      data: {
        status: "COMPLETED",
        // don’t override start time if it already exists
        tripStartedAt: ride.tripStartedAt ?? undefined,
        tripCompletedAt,
        distanceMiles:
          typeof distanceMiles === "number" ? distanceMiles : undefined,
        totalPriceCents:
          typeof fareCents === "number" ? fareCents : undefined,
      },
    });

    return NextResponse.json({ ok: true, tripCompletedAt });
  } catch (err) {
    console.error("POST /driver/complete-ride error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
