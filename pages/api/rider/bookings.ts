// pages/api/rider/bookings.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { BookingStatus } from "@prisma/client";

type ApiBooking = {
  // Primary key of the Booking row (null for “ride-only” entries)
  bookingId: string | null;

  // Stable id used by the UI list:
  // - for real bookings: this === bookingId
  // - for ride-only entries: synthetic "ride-<rideId>"
  id: string;

  status: BookingStatus;

  rideId: string;
  originCity: string;
  destinationCity: string;
  departureTime: string; // ISO string
  rideStatus: string;

  driverName: string | null;
  driverPublicId: string | null;
  conversationId: string | null;

  // true = this list item represents a Ride without a Booking yet
  isRideOnly: boolean;

  // Optional receipt-style details (mostly for COMPLETED rides)
  distanceMiles?: number | null;
  totalPriceCents?: number | null;
  passengerCount?: number | null;
  tripStartedAt?: string | null;
  tripCompletedAt?: string | null;
};

type ApiResponse =
  | { ok: true; bookings: ApiBooking[] }
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

  // Widen user so TS knows about id (and role if we ever need it here)
  const user = session?.user as
    | ({
        id?: string;
        name?: string | null;
        email?: string | null;
        image?: string | null;
      } & {
        role?: "RIDER" | "DRIVER";
      })
    | undefined;

  if (!user?.id) {
    return res
      .status(401)
      .json({ ok: false, error: "Not authenticated" });
  }

  const userId = user.id;

  try {
    //
    // 1) Normal bookings for this rider
    //
    const bookings = await prisma.booking.findMany({
      where: { riderId: userId },
      orderBy: { createdAt: "desc" },
      include: {
        ride: {
          select: {
            id: true,
            originCity: true,
            destinationCity: true,
            departureTime: true,
            status: true,
            distanceMiles: true,
            totalPriceCents: true,
            passengerCount: true,
            tripStartedAt: true,
            tripCompletedAt: true,
            driver: {
              select: {
                name: true,
                publicId: true,
              },
            },
          },
        },
        conversation: {
          select: { id: true },
        },
      },
    });

    const shapedBookings: ApiBooking[] = bookings.map((b) => ({
      // real booking row
      bookingId: b.id,
      id: b.id,
      status: b.status as BookingStatus,

      rideId: b.ride.id,
      originCity: b.ride.originCity,
      destinationCity: b.ride.destinationCity,
      departureTime: b.ride.departureTime.toISOString(),
      rideStatus: b.ride.status,

      driverName: b.ride.driver?.name ?? null,
      driverPublicId: b.ride.driver?.publicId ?? null,
      conversationId: b.conversation?.id ?? null,
      isRideOnly: false,

      distanceMiles: b.ride.distanceMiles,
      totalPriceCents: b.ride.totalPriceCents,
      passengerCount: b.ride.passengerCount,
      tripStartedAt: b.ride.tripStartedAt
        ? b.ride.tripStartedAt.toISOString()
        : null,
      tripCompletedAt: b.ride.tripCompletedAt
        ? b.ride.tripCompletedAt.toISOString()
        : null,
    }));

    //
    // 2) Rider's own rides that *do not* have any Booking yet
    //
    const ridesWithoutBookings = await prisma.ride.findMany({
      where: {
        riderId: userId,
        bookings: { none: {} }, // no bookings at all yet
      },
      orderBy: { createdAt: "desc" },
      include: {
        driver: {
          select: {
            name: true,
            publicId: true,
          },
        },
      },
    });

    const shapedPendingRides: ApiBooking[] = ridesWithoutBookings.map((r) => ({
      bookingId: null, // no booking row yet
      id: `ride-${r.id}`, // synthetic list id
      status: BookingStatus.PENDING, // treat as "request pending" in UI

      rideId: r.id,
      originCity: r.originCity,
      destinationCity: r.destinationCity,
      departureTime: r.departureTime.toISOString(),
      rideStatus: r.status,

      driverName: r.driver?.name ?? null,
      driverPublicId: r.driver?.publicId ?? null,
      conversationId: null,
      isRideOnly: true,

      distanceMiles: r.distanceMiles,
      totalPriceCents: r.totalPriceCents,
      passengerCount: r.passengerCount,
      tripStartedAt: r.tripStartedAt
        ? r.tripStartedAt.toISOString()
        : null,
      tripCompletedAt: r.tripCompletedAt
        ? r.tripCompletedAt.toISOString()
        : null,
    }));

    //
    // 3) Combine: show “request pending” entries first, then real bookings
    //
    const combined: ApiBooking[] = [...shapedPendingRides, ...shapedBookings];

    return res.status(200).json({ ok: true, bookings: combined });
  } catch (err) {
    console.error("Error loading rider bookings:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to load bookings" });
  }
}
