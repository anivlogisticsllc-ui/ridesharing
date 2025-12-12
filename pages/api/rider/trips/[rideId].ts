// pages/api/rider/trips/[rideId].ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import { prisma } from "../../../../lib/prisma";

type TripStatus = "OPEN" | "IN_ROUTE" | "COMPLETED" | "CANCELLED" | string;
type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

type TripDto = {
  rideId: string;
  originAddress: string;
  destinationAddress: string;
  departureTime: string;

  bookingStatus: BookingStatus;
  rideStatus: TripStatus;

  distanceMiles: number | null;
  totalPriceCents: number | null;

  driverName: string | null;
  driverPublicId: string | null;

  requestedAt: string | null;
  tripStartedAt: string | null;
  tripCompletedAt: string | null;

  conversationId: string | null;
};

type ApiResponse =
  | { ok: true; trip: TripDto }
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

  try {
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

    const userId = user.id;
    const { rideId } = req.query;

    if (typeof rideId !== "string") {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid rideId parameter" });
    }

    // 1) Try to find a booking for this rider + ride
    const booking = await prisma.booking.findFirst({
      where: {
        riderId: userId,
        rideId,
      },
      orderBy: { createdAt: "desc" },
      include: {
        ride: {
          include: {
            // Driver is a user-like record
            driver: true,
          },
        },
      },
    });

    // 2) If there is no booking, fall back to ride-only access (if allowed)
    if (!booking) {
      const ride = await prisma.ride.findUnique({
        where: { id: rideId },
        include: {
          driver: true,
        },
      });

      if (!ride) {
        return res
          .status(404)
          .json({ ok: false, error: "Trip not found" });
      }

      const tripFromRideOnly: TripDto = {
        rideId: ride.id,
        originAddress:
          (ride as any).originAddress ??
          (ride as any).originCity ??
          "",
        destinationAddress:
          (ride as any).destinationAddress ??
          (ride as any).destinationCity ??
          "",
        departureTime: ride.departureTime.toISOString(),

        bookingStatus: "PENDING",
        rideStatus: ((ride as any).status as TripStatus) ?? "OPEN",

        distanceMiles: (ride as any).distanceMiles ?? null,
        totalPriceCents: (ride as any).totalPriceCents ?? null,

        driverName:
          ((ride as any).driver?.name as string | undefined) ?? null,
        driverPublicId:
          ((ride as any).driver?.publicId as string | undefined) ?? null,

        requestedAt: ride.createdAt?.toISOString?.() ?? null,
        tripStartedAt:
          (ride as any).tripStartedAt?.toISOString?.() ?? null,
        tripCompletedAt:
          (ride as any).tripCompletedAt?.toISOString?.() ?? null,

        conversationId: null,
      };

      return res.status(200).json({ ok: true, trip: tripFromRideOnly });
    }

    const ride = booking.ride as any;

    const trip: TripDto = {
      rideId: ride.id,
      originAddress:
        ride.originAddress ??
        ride.originCity ??
        "",
      destinationAddress:
        ride.destinationAddress ??
        ride.destinationCity ??
        "",
      departureTime: ride.departureTime.toISOString(),

      bookingStatus: booking.status as BookingStatus,
      rideStatus: (ride.status as TripStatus) ?? "OPEN",

      distanceMiles: ride.distanceMiles ?? null,
      totalPriceCents: ride.totalPriceCents ?? null,

      driverName:
        (ride.driver?.name as string | undefined) ?? null,
      driverPublicId:
        (ride.driver?.publicId as string | undefined) ?? null,

      requestedAt: booking.createdAt.toISOString(),
      tripStartedAt: ride.tripStartedAt?.toISOString?.() ?? null,
      tripCompletedAt: ride.tripCompletedAt?.toISOString?.() ?? null,

      conversationId:
        (booking as any).conversationId ??
        (booking as any).conversation?.id ??
        null,
    };

    return res.status(200).json({ ok: true, trip });
  } catch (err: any) {
    console.error("Error in /api/rider/trips/[rideId]:", err);
    const message =
      err instanceof Error ? err.message : String(err);
    return res
      .status(500)
      .json({ ok: false, error: `Server error: ${message}` });
  }
}
