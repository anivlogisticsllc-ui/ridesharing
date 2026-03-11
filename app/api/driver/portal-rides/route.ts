// app/api/driver/portal-rides/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

type PortalRide = {
  rideId: string;
  originCity: string;
  destinationCity: string;
  departureTime: string;
  status: string;

  riderName: string | null;
  riderPublicId: string | null;

  conversationId: string | null;
  unreadCount: number;

  bookingId: string | null;
  paymentType: string | null;
  cashDiscountBps: number | null;

  tripStartedAt: string | null;
  tripCompletedAt: string | null;
  distanceMiles: number | null;

  // Driver-facing amount to display
  // Prefer booking.finalAmountCents when available
  fareCents: number;
};

type ApiResponse =
  | { ok: true; accepted: PortalRide[]; completed: PortalRide[] }
  | { ok: false; error: string };

type SessionUser = { id?: string; role?: unknown } & Record<string, unknown>;

function isDriverRole(role: unknown) {
  return role === "DRIVER";
}

function computeFareCents(args: {
  rideTotalCents: number | null | undefined;
  bookingFinalAmountCents: number | null | undefined;
}) {
  const { rideTotalCents, bookingFinalAmountCents } = args;

  if (typeof bookingFinalAmountCents === "number" && bookingFinalAmountCents >= 0) {
    return bookingFinalAmountCents;
  }

  return typeof rideTotalCents === "number" ? rideTotalCents : 0;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const user = (session?.user ?? null) as SessionUser | null;

    const userId = user?.id;
    const role = user?.role;

    if (!userId) {
      return NextResponse.json({ ok: false, error: "Not authenticated" } satisfies ApiResponse, {
        status: 401,
      });
    }

    if (!isDriverRole(role)) {
      return NextResponse.json({ ok: false, error: "Not a driver" } satisfies ApiResponse, {
        status: 403,
      });
    }

    const accepted = await prisma.ride.findMany({
      where: {
        driverId: userId,
        status: { in: ["ACCEPTED", "IN_ROUTE"] },
      },
      orderBy: { departureTime: "asc" },
      include: {
        bookings: {
          where: { status: { in: ["ACCEPTED"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            paymentType: true,
            cashDiscountBps: true,
            baseAmountCents: true,
            finalAmountCents: true,
          },
        },
        conversations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true },
        },
        rider: {
          select: {
            name: true,
            publicId: true,
          },
        },
      },
    });

    const completed = await prisma.ride.findMany({
      where: {
        driverId: userId,
        status: "COMPLETED",
      },
      orderBy: { tripCompletedAt: "desc" },
      include: {
        bookings: {
          where: { status: { in: ["COMPLETED", "ACCEPTED"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            paymentType: true,
            cashDiscountBps: true,
            baseAmountCents: true,
            finalAmountCents: true,
          },
        },
        conversations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true },
        },
        rider: {
          select: {
            name: true,
            publicId: true,
          },
        },
      },
    });

    const allRides = [...accepted, ...completed];

    const conversationIds = Array.from(
      new Set(
        allRides
          .map((ride) => ride.conversations?.[0]?.id ?? null)
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      )
    );

    const unreadByConversationId: Record<string, number> = {};

    if (conversationIds.length) {
      const rows = await prisma.$queryRaw<{ conversationId: string; unreadCount: bigint }[]>(
        Prisma.sql`
          SELECT
            c."id" as "conversationId",
            COUNT(m."id")::bigint as "unreadCount"
          FROM "Conversation" c
          LEFT JOIN "Message" m
            ON m."conversationId" = c."id"
           AND m."createdAt" > COALESCE(c."driverLastReadAt", c."createdAt")
           AND m."senderId" <> ${userId}
          WHERE c."driverId" = ${userId}
            AND c."id" IN (${Prisma.join(conversationIds)})
          GROUP BY c."id"
        `
      );

      for (const row of rows) {
        unreadByConversationId[row.conversationId] = Number(row.unreadCount);
      }
    }

    const mapRide = (ride: (typeof accepted)[number]): PortalRide => {
      const booking = ride.bookings?.[0] ?? null;
      const conversationId = ride.conversations?.[0]?.id ?? null;

      const fareCents = computeFareCents({
        rideTotalCents: ride.totalPriceCents,
        bookingFinalAmountCents: booking?.finalAmountCents ?? null,
      });

      return {
        rideId: ride.id,
        originCity: ride.originCity,
        destinationCity: ride.destinationCity,
        departureTime: ride.departureTime.toISOString(),
        status: ride.status,

        riderName: ride.rider?.name ?? null,
        riderPublicId: ride.rider?.publicId ?? null,

        conversationId,
        unreadCount: conversationId ? unreadByConversationId[conversationId] ?? 0 : 0,

        bookingId: booking?.id ?? null,
        paymentType: booking?.paymentType ?? null,
        cashDiscountBps: booking?.cashDiscountBps ?? null,

        tripStartedAt: ride.tripStartedAt ? ride.tripStartedAt.toISOString() : null,
        tripCompletedAt: ride.tripCompletedAt ? ride.tripCompletedAt.toISOString() : null,
        distanceMiles: ride.distanceMiles ?? null,

        fareCents,
      };
    };

    return NextResponse.json(
      {
        ok: true,
        accepted: accepted.map(mapRide),
        completed: completed.map(mapRide),
      } satisfies ApiResponse,
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/driver/portal-rides error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" } satisfies ApiResponse,
      { status: 500 }
    );
  }
}