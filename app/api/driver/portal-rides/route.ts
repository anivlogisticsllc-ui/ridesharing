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
  departureTime: string; // ISO
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

  fareCents: number;
  totalPriceCents: number; // legacy
};

type ApiResponse =
  | { ok: true; accepted: PortalRide[]; completed: PortalRide[] }
  | { ok: false; error: string };

type SessionUser = { id?: string; role?: unknown } & Record<string, unknown>;

function isDriverRole(role: unknown) {
  return role === "DRIVER" || role === "BOTH";
}

function computeReceipt(baseCents: number, cashDiscountBps: number) {
  const discountCents =
    cashDiscountBps > 0 ? Math.round(baseCents * (cashDiscountBps / 10000)) : 0;
  const finalAmountCents = Math.max(0, baseCents - discountCents);
  return { baseAmountCents: baseCents, discountCents, finalAmountCents };
}

function computeFareCents(args: {
  rideTotalCents: number | null | undefined;
  paymentType: string | null | undefined;
  cashDiscountBps: number | null | undefined;
  bookingFinalAmountCents: number | null | undefined;
}) {
  const { rideTotalCents, paymentType, cashDiscountBps, bookingFinalAmountCents } =
    args;

  if (
    typeof bookingFinalAmountCents === "number" &&
    bookingFinalAmountCents > 0
  ) {
    return bookingFinalAmountCents;
  }

  const base = typeof rideTotalCents === "number" ? rideTotalCents : 0;
  const isCash = String(paymentType || "").toUpperCase() === "CASH";
  if (!isCash) return base;

  const bps = typeof cashDiscountBps === "number" ? cashDiscountBps : 0;
  const receipt = computeReceipt(base, bps);
  return receipt.finalAmountCents;
}

export async function GET() {
  try {
    console.time("portal-rides:total");

    const session = await getServerSession(authOptions);
    const user = (session?.user ?? null) as SessionUser | null;

    const userId = user?.id;
    const role = user?.role;

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" } satisfies ApiResponse,
        { status: 401 }
      );
    }

    if (!isDriverRole(role)) {
      return NextResponse.json(
        { ok: false, error: "Not a driver" } satisfies ApiResponse,
        { status: 403 }
      );
    }

    console.time("portal-rides:accepted");
    const accepted = await prisma.ride.findMany({
      where: { driverId: userId, status: { in: ["ACCEPTED", "IN_ROUTE"] } },
      orderBy: { departureTime: "asc" },
      include: {
        bookings: {
          where: { status: { in: ["ACCEPTED"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            paymentType: true,
            paymentMethodId: true,
            cashDiscountBps: true,
            finalAmountCents: true,
            baseAmountCents: true,
            discountCents: true,
            currency: true,
          },
        },
        conversations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true },
        },
        rider: { select: { name: true, publicId: true } },
      },
    });
    console.timeEnd("portal-rides:accepted");

    console.time("portal-rides:completed");
    const completed = await prisma.ride.findMany({
      where: { driverId: userId, status: "COMPLETED" },
      orderBy: { tripCompletedAt: "desc" },
      include: {
        bookings: {
          where: { status: { in: ["COMPLETED", "ACCEPTED"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            paymentType: true,
            paymentMethodId: true,
            cashDiscountBps: true,
            finalAmountCents: true,
            baseAmountCents: true,
            discountCents: true,
            currency: true,
          },
        },
        conversations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true },
        },
        rider: { select: { name: true, publicId: true } },
      },
    });
    console.timeEnd("portal-rides:completed");

    console.time("portal-rides:unread");

    const allRides = [...accepted, ...completed];

    const conversationIds = Array.from(
      new Set(
        allRides
          .map((r) => r.conversations?.[0]?.id ?? null)
          .filter((v): v is string => typeof v === "string" && v.length > 0)
      )
    );

    const unreadByConversationId: Record<string, number> = {};

    if (conversationIds.length) {
      // Single query to compute unread counts per conversation (no N+1).
      // Counts messages newer than COALESCE(driverLastReadAt, createdAt),
      // excluding messages sent by the driver.
      const rows = await prisma.$queryRaw<
        { conversationId: string; unreadCount: bigint }[]
      >(Prisma.sql`
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
      `);

      for (const r of rows) {
        unreadByConversationId[r.conversationId] = Number(r.unreadCount);
      }
    }

    console.timeEnd("portal-rides:unread");

    console.time("portal-rides:response");

    const mapRide = (r: (typeof accepted)[number]): PortalRide => {
      const b = r.bookings?.[0] ?? null;
      const conversationId = r.conversations?.[0]?.id ?? null;

      const fareCents = computeFareCents({
        rideTotalCents: (r as any).totalPriceCents,
        paymentType: b?.paymentType ?? null,
        cashDiscountBps: b?.cashDiscountBps ?? null,
        bookingFinalAmountCents: b?.finalAmountCents ?? null,
      });

      return {
        rideId: r.id,
        originCity: (r as any).originCity,
        destinationCity: (r as any).destinationCity,
        departureTime: (r as any).departureTime.toISOString(),
        status: (r as any).status,

        riderName: r.rider?.name ?? null,
        riderPublicId: r.rider?.publicId ?? null,

        conversationId,
        unreadCount: conversationId
          ? unreadByConversationId[conversationId] ?? 0
          : 0,

        bookingId: b?.id ?? null,
        paymentType: b?.paymentType ?? null,
        cashDiscountBps: b?.cashDiscountBps ?? null,

        tripStartedAt: (r as any).tripStartedAt
          ? (r as any).tripStartedAt.toISOString()
          : null,
        tripCompletedAt: (r as any).tripCompletedAt
          ? (r as any).tripCompletedAt.toISOString()
          : null,
        distanceMiles: (r as any).distanceMiles ?? null,

        fareCents,
        totalPriceCents: fareCents,
      };
    };

    const res = NextResponse.json(
      {
        ok: true,
        accepted: accepted.map(mapRide),
        completed: completed.map(mapRide),
      } satisfies ApiResponse,
      { status: 200 }
    );

    console.timeEnd("portal-rides:response");
    console.timeEnd("portal-rides:total");

    return res;
  } catch (err) {
    console.error("GET /api/driver/portal-rides error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" } satisfies ApiResponse,
      { status: 500 }
    );
  }
}
