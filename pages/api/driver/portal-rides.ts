// pages/api/driver/portal-rides.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { BookingStatus, RideStatus } from "@prisma/client";

type DriverRide = {
  id: string; // ride id (backwards compatibility)
  rideId: string;
  bookingId: string | null;

  originCity: string;
  destinationCity: string;
  departureTime: string; // ISO
  status: RideStatus;

  riderName: string | null;
  riderPublicId: string | null;
  conversationId: string | null;

  tripStartedAt: string | null;
  tripCompletedAt: string | null;
  distanceMiles: number | null;
  totalPriceCents: number | null;
};

type ApiResponse =
  | { ok: true; accepted: DriverRide[]; completed: DriverRide[] }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);

  const user = session?.user as
    | ({
        id?: string;
        role?: "RIDER" | "DRIVER" | "BOTH";
      } & Record<string, unknown>)
    | undefined;

  if (!user?.id) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  if (user.role !== "DRIVER" && user.role !== "BOTH") {
    return res.status(403).json({ ok: false, error: "Not a driver" });
  }

  const driverId = user.id;

  try {
    const rides = await prisma.ride.findMany({
      where: { driverId },
      orderBy: { departureTime: "asc" },
      include: {
        bookings: {
          where: {
            status: { in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED] },
          },
          orderBy: { createdAt: "asc" },
          take: 1,
          include: {
            rider: { select: { name: true, publicId: true } },
          },
        },
        conversations: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { id: true },
        },
      },
    });

    const mapped: DriverRide[] = rides.map((ride) => {
      const booking = ride.bookings[0] ?? null;

      return {
        id: ride.id,
        rideId: ride.id,
        bookingId: booking?.id ?? null,

        originCity: ride.originCity,
        destinationCity: ride.destinationCity,
        departureTime: ride.departureTime.toISOString(),
        status: ride.status,

        riderName: booking?.rider?.name ?? booking?.riderName ?? null,
        riderPublicId: booking?.rider?.publicId ?? null,
        conversationId: ride.conversations[0]?.id ?? null,

        tripStartedAt: ride.tripStartedAt ? ride.tripStartedAt.toISOString() : null,
        tripCompletedAt: ride.tripCompletedAt ? ride.tripCompletedAt.toISOString() : null,
        distanceMiles: ride.distanceMiles ?? null,
        totalPriceCents: ride.totalPriceCents ?? null,
      };
    });

    const accepted = mapped.filter(
      (r) => r.status === RideStatus.ACCEPTED || r.status === RideStatus.IN_ROUTE
    );
    const completed = mapped.filter((r) => r.status === RideStatus.COMPLETED);

    return res.status(200).json({ ok: true, accepted, completed });
  } catch (err) {
    console.error("Error loading driver portal rides:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to load rides for driver portal." });
  }
}
