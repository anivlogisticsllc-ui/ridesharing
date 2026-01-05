// app/api/receipt/[bookingId]/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

function applyCashDiscount(args: {
  baseCents: number | null | undefined;
  paymentType: string | null | undefined;       // "CASH" | "CARD"
  cashDiscountBps: number | null | undefined;   // 1000 = 10%
}) {
  const { baseCents, paymentType, cashDiscountBps } = args;
  if (baseCents === null || baseCents === undefined) return null;

  const isCash = String(paymentType || "").toUpperCase() === "CASH";
  if (!isCash) return baseCents;

  const bps = typeof cashDiscountBps === "number" ? cashDiscountBps : 0;
  if (bps <= 0) return baseCents;

  const discounted = Math.round(baseCents * (1 - bps / 10000));
  return Math.max(0, discounted);
}

export async function GET(_req: Request, { params }: { params: { bookingId: string } }) {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;

  if (!user?.id) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const bookingId = params.bookingId;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      paymentType: true,
      cashDiscountBps: true,
      createdAt: true,

      riderId: true,
      riderName: true,
      riderEmail: true,

      ride: {
        select: {
          id: true,
          originCity: true,
          destinationCity: true,
          // if you have these as fields, keep them; if not, remove
          originAddress: true as any,
          destinationAddress: true as any,

          departureTime: true,
          tripStartedAt: true,
          tripCompletedAt: true,
          distanceMiles: true,
          totalPriceCents: true,

          driverId: true,
          driver: { select: { name: true, email: true } },
          rider: { select: { name: true, email: true } },
        },
      },
    },
  });

  if (!booking || !booking.ride) {
    return NextResponse.json({ ok: false, error: "Receipt not found." }, { status: 404 });
  }

  const ride = booking.ride;

  // Allow rider on booking OR driver on ride
  const isDriver = ride.driverId === user.id;
  const isRider = booking.riderId === user.id;

  if (!isDriver && !isRider) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const computedTotalCents = applyCashDiscount({
    baseCents: ride.totalPriceCents,
    paymentType: booking.paymentType,
    cashDiscountBps: booking.cashDiscountBps,
  });

  return NextResponse.json({
    ok: true,
    booking: {
      id: booking.id,
      status: booking.status,
      paymentType: booking.paymentType ?? null,
      cashDiscountBps: booking.cashDiscountBps ?? null,
      createdAt: booking.createdAt.toISOString(),
    },
    ride: {
      id: ride.id,
      originCity: ride.originCity,
      destinationCity: ride.destinationCity,
      originAddress: (ride as any).originAddress ?? null,
      destinationAddress: (ride as any).destinationAddress ?? null,
      departureTime: ride.departureTime.toISOString(),
      tripStartedAt: ride.tripStartedAt ? ride.tripStartedAt.toISOString() : null,
      tripCompletedAt: ride.tripCompletedAt ? ride.tripCompletedAt.toISOString() : null,
      distanceMiles: ride.distanceMiles ?? null,

      // ✅ discounted when CASH
      totalPriceCents: computedTotalCents,

      driverName: ride.driver?.name ?? null,
      driverEmail: ride.driver?.email ?? null,
      riderName: ride.rider?.name ?? booking.riderName ?? null,
      riderEmail: ride.rider?.email ?? booking.riderEmail ?? null,
    },
  });
}
