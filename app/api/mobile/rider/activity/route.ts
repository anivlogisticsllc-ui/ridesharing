// app/api/mobile/rider/activity/route.ts

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { RideStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const JWT_SECRET = process.env.MOBILE_JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("MOBILE_JWT_SECRET is not configured");
}

const secret = new TextEncoder().encode(JWT_SECRET);

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:8081",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store, max-age=0",
};

type MobileJwtPayload = {
  sub?: string;
  role?: string;
  email?: string;
};

type ActiveRide = {
  rideId: string;
  bookingId: string | null;
  bookingStatus: string;
  rideStatus: string;
  conversationId: string | null;
  departureTime: string;
  tripStartedAt: string | null;
};

type ApiResponse =
  | {
      ok: true;
      activeRide: ActiveRide | null;
    }
  | {
      ok: false;
      error: string;
    };

async function getMobileUserId(
  req: NextRequest
): Promise<string | null> {
  const authHeader =
    req.headers.get("authorization") || "";

  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader
    .slice("Bearer ".length)
    .trim();

  if (!token) {
    return null;
  }

  try {
    const verified = await jwtVerify(
      token,
      secret
    );

    const payload =
      verified.payload as MobileJwtPayload;

    return typeof payload.sub === "string" &&
      payload.sub
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

function ridePriority(
  rideStatus: RideStatus
): number {
  if (
    rideStatus === RideStatus.IN_ROUTE
  ) {
    return 20;
  }

  if (
    rideStatus === RideStatus.ACCEPTED
  ) {
    return 10;
  }

  return 0;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET(
  req: NextRequest
) {
  try {
    const riderId =
      await getMobileUserId(req);

    if (!riderId) {
      return NextResponse.json<ApiResponse>(
        {
          ok: false,
          error: "Not authenticated",
        },
        {
          status: 401,
          headers: corsHeaders,
        }
      );
    }

    /*
     * We only need active/accepted rides here.
     *
     * Do NOT load:
     * - completed ride history
     * - disputes
     * - refunds
     * - RidePayment records
     * - tip information
     * - fare breakdowns
     *
     * Those belong in /api/mobile/rider/bookings.
     */
    const bookings =
      await prisma.booking.findMany({
        where: {
          riderId,
          ride: {
            status: {
              in: [
                RideStatus.ACCEPTED,
                RideStatus.IN_ROUTE,
              ],
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 5,
        select: {
          id: true,
          status: true,

          conversation: {
            select: {
              id: true,
            },
          },

          ride: {
            select: {
              id: true,
              status: true,
              departureTime: true,
              tripStartedAt: true,
            },
          },
        },
      });

    /*
     * Normally the rider's active trip has a Booking.
     *
     * We still preserve support for ride-only records
     * because your existing bookings endpoint supports them.
     */
    const rideOnly =
      await prisma.ride.findMany({
        where: {
          riderId,
          status: {
            in: [
              RideStatus.ACCEPTED,
              RideStatus.IN_ROUTE,
            ],
          },
          bookings: {
            none: {},
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 5,
        select: {
          id: true,
          status: true,
          departureTime: true,
          tripStartedAt: true,
        },
      });

    const candidates: ActiveRide[] = [
      ...bookings.map(
        (booking): ActiveRide => ({
          rideId: booking.ride.id,
          bookingId: booking.id,

          bookingStatus: String(
            booking.status
          ),

          rideStatus: String(
            booking.ride.status
          ),

          conversationId:
            booking.conversation?.id ??
            null,

          departureTime:
            booking.ride.departureTime.toISOString(),

          tripStartedAt:
            booking.ride.tripStartedAt
              ? booking.ride.tripStartedAt.toISOString()
              : null,
        })
      ),

      ...rideOnly.map(
        (ride): ActiveRide => ({
          rideId: ride.id,
          bookingId: null,

          bookingStatus: "PENDING",

          rideStatus: String(
            ride.status
          ),

          conversationId: null,

          departureTime:
            ride.departureTime.toISOString(),

          tripStartedAt:
            ride.tripStartedAt
              ? ride.tripStartedAt.toISOString()
              : null,
        })
      ),
    ];

    /*
     * IN_ROUTE always wins over ACCEPTED.
     *
     * If multiple rides somehow have the same priority,
     * prefer the most recently scheduled one.
     */
    candidates.sort((a, b) => {
      const priorityDifference =
        ridePriority(
          b.rideStatus as RideStatus
        ) -
        ridePriority(
          a.rideStatus as RideStatus
        );

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return (
        new Date(
          b.departureTime
        ).getTime() -
        new Date(
          a.departureTime
        ).getTime()
      );
    });

    const activeRide =
      candidates[0] ?? null;

    return NextResponse.json<ApiResponse>(
      {
        ok: true,
        activeRide,
      },
      {
        headers: corsHeaders,
      }
    );
  } catch (err) {
    console.error(
      "[mobile/rider/activity] error:",
      err
    );

    return NextResponse.json<ApiResponse>(
      {
        ok: false,
        error:
          "Failed to load rider activity",
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}