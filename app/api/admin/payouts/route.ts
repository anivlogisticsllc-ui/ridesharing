// OATH: Clean replacement file
// FILE: app/api/admin/payouts/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { UserRole } from "@prisma/client";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { buildDriverPayoutView } from "@/lib/payouts/buildDriverPayoutView";

type SessionUser = {
  id?: string | null;
  role?: UserRole | string | null;
};

type CreatePayoutBody = {
  driverId?: string;
  payoutWeekKey?: string;
};

function asCleanString(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as SessionUser | undefined;

    const adminId = typeof user?.id === "string" ? user.id.trim() : "";
    if (!adminId) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    if (user?.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { ok: false, error: "Only admins can create payouts." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as CreatePayoutBody;

    const driverId = asCleanString(body.driverId);
    const payoutWeekKey = asCleanString(body.payoutWeekKey);

    if (!driverId) {
      return NextResponse.json(
        { ok: false, error: "driverId is required." },
        { status: 400 }
      );
    }

    if (!payoutWeekKey) {
      return NextResponse.json(
        { ok: false, error: "payoutWeekKey is required." },
        { status: 400 }
      );
    }

    const driver = await prisma.user.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        role: true,
        name: true,
        email: true,
        stripeConnectedAccountId: true,
        stripePayoutsEnabled: true,
        stripeChargesEnabled: true,
        stripeAccountReady: true,
      },
    });

    if (!driver || driver.role !== UserRole.DRIVER) {
      return NextResponse.json(
        { ok: false, error: "Driver not found." },
        { status: 404 }
      );
    }

    const existingPayout = await prisma.payout.findFirst({
      where: {
        driverId,
        payoutWeekKey,
      },
      select: {
        id: true,
        status: true,
        amountCents: true,
        createdAt: true,
      },
    });

    if (existingPayout) {
      return NextResponse.json(
        {
          ok: false,
          error: "A payout record already exists for this driver and week.",
          existingPayout: {
            id: existingPayout.id,
            status: existingPayout.status,
            amountCents: existingPayout.amountCents,
            createdAt: existingPayout.createdAt.toISOString(),
          },
        },
        { status: 409 }
      );
    }

    const billing = await buildDriverPayoutView(driverId);

    const selectedWeek =
      billing.weeklyPayouts.find((w) => w.key === payoutWeekKey) ?? null;

    if (!selectedWeek) {
      return NextResponse.json(
        { ok: false, error: "Selected payout week not found." },
        { status: 404 }
      );
    }

    if (selectedWeek.finalTransferAmountCents <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Selected week has no payable transfer amount.",
          week: {
            key: selectedWeek.key,
            finalTransferAmountCents: selectedWeek.finalTransferAmountCents,
            cardPayableNetAmountCents: selectedWeek.cardPayableNetAmountCents,
            cashRideServiceFeeOffsetCents:
              selectedWeek.cashRideServiceFeeOffsetCents,
            driverDisputeFeeCents: selectedWeek.driverDisputeFeeCents,
          },
        },
        { status: 400 }
      );
    }

    const payout = await prisma.payout.create({
      data: {
        driverId,
        amountCents: selectedWeek.finalTransferAmountCents,
        currency: "USD",
        status: "PENDING",
        provider: "STRIPE",

        payoutWeekKey: selectedWeek.key,
        payoutWeekStart: new Date(selectedWeek.weekStart),
        payoutWeekEnd: new Date(selectedWeek.weekEnd),

        cardPayableNetAmountCents: selectedWeek.cardPayableNetAmountCents,
        cashRideServiceFeeOffsetCents:
          selectedWeek.cashRideServiceFeeOffsetCents,
        driverDisputeFeeCents: selectedWeek.driverDisputeFeeCents,
      },
      select: {
        id: true,
        amountCents: true,
        currency: true,
        status: true,
        provider: true,
        payoutWeekKey: true,
        payoutWeekStart: true,
        payoutWeekEnd: true,
        cardPayableNetAmountCents: true,
        cashRideServiceFeeOffsetCents: true,
        driverDisputeFeeCents: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      ok: true,
      payout: {
        id: payout.id,
        amountCents: payout.amountCents,
        currency: payout.currency,
        status: payout.status,
        provider: payout.provider,
        payoutWeekKey: payout.payoutWeekKey,
        payoutWeekStart: payout.payoutWeekStart?.toISOString() ?? null,
        payoutWeekEnd: payout.payoutWeekEnd?.toISOString() ?? null,
        cardPayableNetAmountCents: payout.cardPayableNetAmountCents,
        cashRideServiceFeeOffsetCents: payout.cashRideServiceFeeOffsetCents,
        driverDisputeFeeCents: payout.driverDisputeFeeCents,
        createdAt: payout.createdAt.toISOString(),
      },
      driver: {
        id: driver.id,
        name: driver.name ?? null,
        email: driver.email,
        stripeConnectedAccountId: driver.stripeConnectedAccountId ?? null,
        stripePayoutsEnabled: driver.stripePayoutsEnabled,
        stripeChargesEnabled: driver.stripeChargesEnabled,
        stripeAccountReady: driver.stripeAccountReady,
      },
      week: {
        key: selectedWeek.key,
        label: selectedWeek.label,
        finalTransferAmountCents: selectedWeek.finalTransferAmountCents,
        cardPayableNetAmountCents: selectedWeek.cardPayableNetAmountCents,
        cashRideServiceFeeOffsetCents:
          selectedWeek.cashRideServiceFeeOffsetCents,
        driverDisputeFeeCents: selectedWeek.driverDisputeFeeCents,
      },
    });
  } catch (error) {
    console.error("[POST /api/admin/payouts] error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}