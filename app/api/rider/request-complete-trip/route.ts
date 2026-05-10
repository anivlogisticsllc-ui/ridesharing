// app/api/rider/request-complete-trip/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { RideStatus, UserRole } from "@prisma/client";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

type SessionUser = {
  id?: string | null;
  role?: UserRole | string | null;
};

type Body = {
  rideId?: string;
};

function asMessage(err: unknown) {
  return err instanceof Error
    ? err.message
    : typeof err === "string"
    ? err
    : "Unknown error";
}

function asIso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

async function tryCreateDriverChatEvidence(args: {
  conversationId: string | null;
  riderId: string;
  body: string;
}) {
  const { conversationId, riderId, body } = args;
  if (!conversationId) return;

  try {
    await Promise.race([
      prisma.message.create({
        data: {
          conversationId,
          senderId: riderId,
          body,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Chat write timed out")), 1200)
      ),
    ]);
  } catch (err) {
    console.error(
      "[POST /api/rider/request-complete-trip] chat evidence write skipped:",
      err
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as SessionUser | undefined;

    const riderId = typeof user?.id === "string" ? user.id.trim() : "";
    if (!riderId) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    if (user?.role !== UserRole.RIDER) {
      return NextResponse.json(
        { ok: false, error: "Only riders can request trip completion." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const rideId = typeof body.rideId === "string" ? body.rideId.trim() : "";

    if (!rideId) {
      return NextResponse.json(
        { ok: false, error: "rideId is required" },
        { status: 400 }
      );
    }

    const booking = await prisma.booking.findFirst({
      where: {
        rideId,
        riderId,
      },
      select: {
        id: true,
        riderId: true,
        rideId: true,
        status: true,
        paymentType: true,
        cashDiscountBps: true,
        baseAmountCents: true,
        finalAmountCents: true,
        currency: true,
        conversation: {
          select: {
            id: true,
          },
        },
        ride: {
          select: {
            id: true,
            status: true,
            driverId: true,
            departureTime: true,
            tripStartedAt: true,
            tripCompletedAt: true,
            distanceMiles: true,
            totalPriceCents: true,
            originCity: true,
            destinationCity: true,
            riderId: true,
          },
        },
      },
    });

    if (!booking?.ride) {
      return NextResponse.json(
        { ok: false, error: "Ride not found for this rider." },
        { status: 404 }
      );
    }

    if (booking.ride.riderId && booking.ride.riderId !== riderId) {
      return NextResponse.json(
        { ok: false, error: "You do not have access to this ride." },
        { status: 403 }
      );
    }

    if (booking.ride.status === RideStatus.COMPLETED) {
      return NextResponse.json({
        ok: true,
        alreadyCompleted: true,
        rideId: booking.ride.id,
        message: "This ride is already completed.",
      });
    }

    if (booking.ride.status !== RideStatus.IN_ROUTE) {
      return NextResponse.json(
        {
          ok: false,
          error: "Trip completion can only be requested while the ride is in progress.",
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const dedupeWindowStart = new Date(now.getTime() - 60_000);

    const recentAudit = await prisma.rideAuditLog.findFirst({
      where: {
        bookingId: booking.id,
        type: "RIDER_REQUESTED_TRIP_COMPLETION",
        actorUserId: riderId,
        createdAt: {
          gte: dedupeWindowStart,
        },
      },
      select: {
        id: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (recentAudit) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        rideId: booking.ride.id,
        bookingId: booking.id,
        requestedAt: recentAudit.createdAt.toISOString(),
        message: "A completion request was already sent recently.",
      });
    }

    const snapshot = {
      rideId: booking.ride.id,
      bookingId: booking.id,
      riderId,
      driverId: booking.ride.driverId ?? null,
      rideStatus: String(booking.ride.status),
      bookingStatus: String(booking.status),
      paymentType: booking.paymentType ?? null,
      cashDiscountBps: booking.cashDiscountBps ?? null,
      currency: booking.currency ?? "USD",
      fareSnapshotCents:
        booking.finalAmountCents ??
        booking.baseAmountCents ??
        booking.ride.totalPriceCents ??
        null,
      rideDistanceMiles: booking.ride.distanceMiles ?? null,
      tripStartedAt: asIso(booking.ride.tripStartedAt),
      tripCompletedAt: asIso(booking.ride.tripCompletedAt),
      departureTime: asIso(booking.ride.departureTime),
      originCity: booking.ride.originCity,
      destinationCity: booking.ride.destinationCity,
      riderRequestedCompletionAt: now.toISOString(),
      source: "rider_portal_complete_trip_request",
    };

    const driverMessage =
      "Rider requested trip completion. Please stop the meter if the trip has ended.";

    // Required write: this powers the driver banner and evidence trail.
    await prisma.rideAuditLog.create({
      data: {
        bookingId: booking.id,
        type: "RIDER_REQUESTED_TRIP_COMPLETION",
        message: driverMessage,
        actorUserId: riderId,
        meta: snapshot,
      },
    });

    // Best-effort chat evidence: do not let this hold the rider UI hostage.
    void tryCreateDriverChatEvidence({
      conversationId: booking.conversation?.id ?? null,
      riderId,
      body: driverMessage,
    });

    return NextResponse.json({
      ok: true,
      rideId: booking.ride.id,
      bookingId: booking.id,
      requestedAt: now.toISOString(),
      conversationId: booking.conversation?.id ?? null,
      message: "Completion request sent to your driver.",
    });
  } catch (err) {
    console.error("[POST /api/rider/request-complete-trip] error:", err);

    return NextResponse.json(
      { ok: false, error: asMessage(err) },
      { status: 500 }
    );
  }
}