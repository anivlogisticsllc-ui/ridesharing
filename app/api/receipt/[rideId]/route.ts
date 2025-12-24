import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: { rideId: string } }
) {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;

  if (!user?.id) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const rideId = params.rideId;

  // Allow rider or driver on that ride to view
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    include: {
      rider: { select: { name: true, email: true } },
      driver: { select: { name: true } },
    },
  });

  if (!ride) {
    return NextResponse.json({ ok: false, error: "Receipt not found." }, { status: 404 });
  }

  const isDriver = ride.driverId === user.id;
  const isRider = ride.riderId === user.id;

  if (!isDriver && !isRider) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    ride: {
      id: ride.id,
      originCity: ride.originCity,
      destinationCity: ride.destinationCity,
      originAddress: (ride as any).originAddress ?? null,
      destinationAddress: (ride as any).destinationAddress ?? null,
      departureTime: ride.departureTime.toISOString(),
      tripStartedAt: ride.tripStartedAt ? ride.tripStartedAt.toISOString() : null,
      tripCompletedAt: ride.tripCompletedAt ? ride.tripCompletedAt.toISOString() : null,
      distanceMiles: ride.distanceMiles ?? null,
      totalPriceCents: ride.totalPriceCents ?? null,
      driverName: ride.driver?.name ?? null,
      riderName: ride.rider?.name ?? null,
      riderEmail: ride.rider?.email ?? null,
    },
  });
}
