// app/api/driver/portal-rides/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";

function isDriverRole(role: UserRole | undefined) {
  return role === "DRIVER";
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
  const { rideTotalCents, paymentType, cashDiscountBps, bookingFinalAmountCents } = args;

  // Best source of truth: booking snapshot
  if (typeof bookingFinalAmountCents === "number" && bookingFinalAmountCents > 0) {
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
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id as string | undefined;
    const role = (session?.user?.role as UserRole | undefined) ?? undefined;

    if (!userId) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }
    if (!isDriverRole(role)) {
      return NextResponse.json({ ok: false, error: "Not a driver" }, { status: 403 });
    }

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

    const mapRide = (r: any) => {
      const b = r.bookings?.[0] ?? null;

      const fareCents = computeFareCents({
        rideTotalCents: r.totalPriceCents,
        paymentType: b?.paymentType ?? null,
        cashDiscountBps: b?.cashDiscountBps ?? null,
        bookingFinalAmountCents: b?.finalAmountCents ?? null,
      });

      return {
        rideId: r.id,
        originCity: r.originCity,
        destinationCity: r.destinationCity,
        departureTime: r.departureTime.toISOString(),
        status: r.status,

        riderName: r.rider?.name ?? null,
        riderPublicId: r.rider?.publicId ?? null,

        conversationId: r.conversations?.[0]?.id ?? null,

        bookingId: b?.id ?? null,
        paymentType: b?.paymentType ?? null,
        cashDiscountBps: b?.cashDiscountBps ?? null,

        tripStartedAt: r.tripStartedAt ? r.tripStartedAt.toISOString() : null,
        tripCompletedAt: r.tripCompletedAt ? r.tripCompletedAt.toISOString() : null,
        distanceMiles: r.distanceMiles ?? null,

        // expose both so older UI keeps working
        fareCents,
        totalPriceCents: fareCents,
      };
    };

    return NextResponse.json(
      { ok: true, accepted: accepted.map(mapRide), completed: completed.map(mapRide) },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/driver/portal-rides error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
