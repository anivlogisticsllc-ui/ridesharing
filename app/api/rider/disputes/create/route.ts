// OATH: Clean replacement file
// FILE: app/api/rider/disputes/create/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import {
  BookingStatus,
  DisputeReason,
  DisputeStatus,
  NotificationType,
  PaymentType,
  RidePaymentStatus,
  RideStatus,
  UserRole,
} from "@prisma/client";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

type SessionUser = {
  id?: string | null;
  role?: UserRole | string | null;
};

type Body = {
  bookingId?: string;
  reason?: "CASH_ALREADY_PAID" | "UNAUTHORIZED_FALLBACK_CHARGE" | "OTHER";
  riderStatement?: string;
};

function asMessage(err: unknown) {
  return err instanceof Error
    ? err.message
    : typeof err === "string"
    ? err
    : "Unknown error";
}

function isValidReason(v: unknown): v is Body["reason"] {
  return (
    v === "CASH_ALREADY_PAID" ||
    v === "UNAUTHORIZED_FALLBACK_CHARGE" ||
    v === "OTHER"
  );
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
        { ok: false, error: "Only riders can create disputes." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Body;

    const bookingId =
      typeof body.bookingId === "string" ? body.bookingId.trim() : "";

    if (!bookingId) {
      return NextResponse.json(
        { ok: false, error: "bookingId is required" },
        { status: 400 }
      );
    }

    if (!isValidReason(body.reason)) {
      return NextResponse.json(
        { ok: false, error: "Valid dispute reason is required" },
        { status: 400 }
      );
    }

    const riderStatement =
      typeof body.riderStatement === "string"
        ? body.riderStatement.trim().slice(0, 3000)
        : "";

    if (!riderStatement) {
      return NextResponse.json(
        { ok: false, error: "Please enter your statement" },
        { status: 400 }
      );
    }

    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        riderId,
      },
      select: {
        id: true,
        rideId: true,
        riderId: true,
        paymentType: true,
        status: true,
        cashNotPaidAt: true,
        fallbackCardChargedAt: true,
        ride: {
          select: {
            id: true,
            status: true,
            driverId: true,
          },
        },
      },
    });

    if (!booking?.ride) {
      return NextResponse.json(
        { ok: false, error: "Booking not found" },
        { status: 404 }
      );
    }

    if (
      booking.status !== BookingStatus.COMPLETED ||
      booking.ride.status !== RideStatus.COMPLETED
    ) {
      return NextResponse.json(
        { ok: false, error: "Only completed rides can be disputed." },
        { status: 400 }
      );
    }

    if (
      booking.paymentType !== PaymentType.CARD ||
      !booking.cashNotPaidAt ||
      !booking.fallbackCardChargedAt
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "This booking does not have a fallback card charge to dispute.",
        },
        { status: 400 }
      );
    }

    const existingOpen = await prisma.dispute.findFirst({
      where: {
        bookingId: booking.id,
        riderId,
        status: {
          in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW],
        },
      },
      select: {
        id: true,
      },
    });

    if (existingOpen) {
      return NextResponse.json(
        {
          ok: false,
          error: "An open dispute already exists for this charge.",
        },
        { status: 409 }
      );
    }

    const ridePayment = await prisma.ridePayment.findFirst({
      where: {
        rideId: booking.rideId,
        riderId,
        paymentType: PaymentType.CARD,
        status: RidePaymentStatus.SUCCEEDED,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
      },
    });

    const created = await prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.create({
        data: {
          rideId: booking.ride.id,
          bookingId: booking.id,
          ridePaymentId: ridePayment?.id ?? null,
          riderId,
          driverId: booking.ride.driverId ?? null,
          reason: body.reason as DisputeReason,
          status: DisputeStatus.OPEN,
          riderStatement,
        },
        select: {
          id: true,
          status: true,
          bookingId: true,
          rideId: true,
          reason: true,
          createdAt: true,
        },
      });

      await tx.notification.updateMany({
        where: {
          userId: riderId,
          bookingId: booking.id,
          type: NotificationType.CASH_UNPAID_FALLBACK_CHARGED,
          readAt: null,
        },
        data: {
          readAt: new Date(),
        },
      });

      if (booking.ride.driverId) {
        await tx.notification.create({
          data: {
            userId: booking.ride.driverId,
            rideId: booking.ride.id,
            bookingId: booking.id,
            type: NotificationType.DISPUTE_OPENED,
            title: "Rider filed a dispute",
            message: "A rider disputed the fallback card charge for this ride.",
            metadata: {
              disputeId: dispute.id,
              bookingId: booking.id,
              rideId: booking.ride.id,
            },
          },
        });
      }

      const admins = await tx.user.findMany({
        where: {
          role: UserRole.ADMIN,
        },
        select: {
          id: true,
        },
      });

      if (admins.length > 0) {
        await tx.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            rideId: booking.ride.id,
            bookingId: booking.id,
            type: NotificationType.DISPUTE_OPENED,
            title: "New dispute opened",
            message: "A rider opened a dispute for a fallback card charge.",
            metadata: {
              disputeId: dispute.id,
              bookingId: booking.id,
              rideId: booking.ride.id,
            },
          })),
        });
      }

      return dispute;
    });

    return NextResponse.json({
      ok: true,
      dispute: {
        id: created.id,
        status: String(created.status),
        bookingId: created.bookingId,
        rideId: created.rideId,
        reason: String(created.reason),
        createdAt: created.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[POST /api/rider/disputes/create] error:", err);

    return NextResponse.json(
      { ok: false, error: asMessage(err) },
      { status: 500 }
    );
  }
}
