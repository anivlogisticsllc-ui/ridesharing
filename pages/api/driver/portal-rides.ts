// pages/api/driver/portal-rides.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { BookingStatus, RideStatus } from "@prisma/client";

type DriverRide = {
  id: string;
  originCity: string;
  destinationCity: string;
  departureTime: string; // ISO
  status: RideStatus;
  riderName: string | null;
  riderPublicId: string | null;
  conversationId: string | null;
};

type ApiResponse =
  | { ok: true; accepted: DriverRide[]; completed: DriverRide[] }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);

  const user = session?.user as
    | ({
        id?: string;
        name?: string | null;
        email?: string | null;
        image?: string | null;
      } & {
        role?: "RIDER" | "DRIVER" | "BOTH";
      })
    | undefined;

  if (!user?.id) {
    return res
      .status(401)
      .json({ ok: false, error: "Not authenticated" });
  }

  const role = user.role;
  if (role !== "DRIVER" && role !== "BOTH") {
    return res
      .status(403)
      .json({ ok: false, error: "Not a driver" });
  }

  const driverId = user.id;

  try {
    const rides = await prisma.ride.findMany({
      where: { driverId },
      orderBy: { departureTime: "asc" },
      include: {
        bookings: {
          where: {
            status: {
              in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED],
            },
          },
          orderBy: { createdAt: "asc" },
          take: 1,
          include: {
            rider: {
              select: {
                name: true,
                publicId: true,
              },
            },
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
      const riderName =
        booking?.rider?.name ?? booking?.riderName ?? null;
      const riderPublicId = booking?.rider?.publicId ?? null;
      const conversationId = ride.conversations[0]?.id ?? null;

      return {
        id: ride.id,
        originCity: ride.originCity,
        destinationCity: ride.destinationCity,
        departureTime: ride.departureTime.toISOString(),
        status: ride.status,
        riderName,
        riderPublicId,
        conversationId,
      };
    });

    // Fix: use direct enum comparisons instead of `includes`
    const accepted = mapped.filter(
      (r) =>
        r.status === RideStatus.ACCEPTED ||
        r.status === RideStatus.IN_ROUTE
    );

    const completed = mapped.filter(
      (r) => r.status === RideStatus.COMPLETED
    );

    return res.status(200).json({ ok: true, accepted, completed });
  } catch (err) {
    console.error("Error loading driver portal rides:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to load rides for driver portal.",
    });
  }
}
