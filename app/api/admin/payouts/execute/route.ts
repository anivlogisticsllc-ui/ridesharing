// OATH: Clean replacement file
// FILE: app/api/admin/payouts/execute/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { UserRole, PayoutStatus } from "@prisma/client";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

type SessionUser = {
  id?: string | null;
  role?: UserRole | string | null;
};

type ExecutePayoutBody = {
  payoutId?: string;
};

function asCleanString(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Internal server error";
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
        { ok: false, error: "Only admins can execute payouts." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as ExecutePayoutBody;
    const payoutId = asCleanString(body.payoutId);

    if (!payoutId) {
      return NextResponse.json(
        { ok: false, error: "payoutId is required." },
        { status: 400 }
      );
    }

    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
      select: {
        id: true,
        driverId: true,
        amountCents: true,
        currency: true,
        status: true,
        provider: true,
        providerRef: true,
        payoutWeekKey: true,
        payoutWeekStart: true,
        payoutWeekEnd: true,
        cardPayableNetAmountCents: true,
        cashRideServiceFeeOffsetCents: true,
        driverDisputeFeeCents: true,
        createdAt: true,
        updatedAt: true,
        executedAt: true,
        failureReason: true,
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
            stripeConnectedAccountId: true,
            stripePayoutsEnabled: true,
            stripeChargesEnabled: true,
            stripeAccountReady: true,
            externalBankLast4: true,
            externalBankName: true,
          },
        },
      },
    });

    if (!payout) {
      return NextResponse.json(
        { ok: false, error: "Payout not found." },
        { status: 404 }
      );
    }

    if (payout.status === PayoutStatus.PAID) {
      return NextResponse.json(
        {
          ok: false,
          error: "This payout has already been executed.",
          payout: {
            id: payout.id,
            status: payout.status,
            providerRef: payout.providerRef ?? null,
            executedAt: payout.executedAt?.toISOString() ?? null,
          },
        },
        { status: 409 }
      );
    }

    if (payout.status !== PayoutStatus.PENDING) {
      return NextResponse.json(
        {
          ok: false,
          error: `Only PENDING payouts can be executed. Current status: ${payout.status}`,
          payout: {
            id: payout.id,
            status: payout.status,
            providerRef: payout.providerRef ?? null,
            failureReason: payout.failureReason ?? null,
          },
        },
        { status: 400 }
      );
    }

    if (payout.providerRef) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This payout already has a provider reference and may have been executed.",
          payout: {
            id: payout.id,
            status: payout.status,
            providerRef: payout.providerRef,
          },
        },
        { status: 409 }
      );
    }

    if (payout.amountCents <= 0) {
      return NextResponse.json(
        { ok: false, error: "Payout amount must be greater than zero." },
        { status: 400 }
      );
    }

    const driver = payout.driver;

    if (!driver?.stripeConnectedAccountId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Driver does not have a Stripe connected account.",
          driver: {
            id: driver?.id ?? payout.driverId,
            email: driver?.email ?? null,
            stripeConnectedAccountId: null,
          },
        },
        { status: 400 }
      );
    }

    if (!driver.stripePayoutsEnabled || !driver.stripeAccountReady) {
      return NextResponse.json(
        {
          ok: false,
          error: "Driver Stripe account is not payout-ready.",
          driver: {
            id: driver.id,
            email: driver.email,
            stripeConnectedAccountId: driver.stripeConnectedAccountId,
            stripePayoutsEnabled: driver.stripePayoutsEnabled,
            stripeChargesEnabled: driver.stripeChargesEnabled,
            stripeAccountReady: driver.stripeAccountReady,
          },
        },
        { status: 400 }
      );
    }

    // Atomic claim step:
    // only one request should move forward while status is still PENDING
    const claim = await prisma.payout.updateMany({
      where: {
        id: payout.id,
        status: PayoutStatus.PENDING,
        providerRef: null,
      },
      data: {
        executedAt: new Date(),
        failureReason: null,
      },
    });

    if (claim.count !== 1) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This payout is no longer available for execution. Refresh and try again.",
        },
        { status: 409 }
      );
    }

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: payout.amountCents,
          currency: String(payout.currency || "usd").toLowerCase(),
          destination: driver.stripeConnectedAccountId,
          metadata: {
            payoutId: payout.id,
            driverId: payout.driverId,
            payoutWeekKey: payout.payoutWeekKey ?? "",
            driverEmail: driver.email,
            driverName: driver.name ?? "",
            cardPayableNetAmountCents: String(payout.cardPayableNetAmountCents),
            cashRideServiceFeeOffsetCents: String(
              payout.cashRideServiceFeeOffsetCents
            ),
            driverDisputeFeeCents: String(payout.driverDisputeFeeCents),
            executedByAdminId: adminId,
          },
        },
        {
          idempotencyKey: `payout_execute_${payout.id}`,
        }
      );

      const updated = await prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: PayoutStatus.PAID,
          provider: "STRIPE",
          providerRef: transfer.id,
          executedAt: new Date(),
          failureReason: null,
        },
        select: {
          id: true,
          amountCents: true,
          currency: true,
          status: true,
          provider: true,
          providerRef: true,
          payoutWeekKey: true,
          payoutWeekStart: true,
          payoutWeekEnd: true,
          cardPayableNetAmountCents: true,
          cashRideServiceFeeOffsetCents: true,
          driverDisputeFeeCents: true,
          createdAt: true,
          updatedAt: true,
          executedAt: true,
          failureReason: true,
        },
      });

      return NextResponse.json({
        ok: true,
        payout: {
          id: updated.id,
          amountCents: updated.amountCents,
          currency: updated.currency,
          status: updated.status,
          provider: updated.provider,
          providerRef: updated.providerRef ?? null,
          payoutWeekKey: updated.payoutWeekKey ?? null,
          payoutWeekStart: updated.payoutWeekStart?.toISOString() ?? null,
          payoutWeekEnd: updated.payoutWeekEnd?.toISOString() ?? null,
          cardPayableNetAmountCents: updated.cardPayableNetAmountCents,
          cashRideServiceFeeOffsetCents: updated.cashRideServiceFeeOffsetCents,
          driverDisputeFeeCents: updated.driverDisputeFeeCents,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
          executedAt: updated.executedAt?.toISOString() ?? null,
          failureReason: updated.failureReason ?? null,
        },
        transfer: {
          id: transfer.id,
          amount: transfer.amount,
          currency: transfer.currency,
          destination:
            typeof transfer.destination === "string"
              ? transfer.destination
              : transfer.destination?.id ?? null,
        },
        driver: {
          id: driver.id,
          name: driver.name ?? null,
          email: driver.email,
          stripeConnectedAccountId: driver.stripeConnectedAccountId,
          externalBankName: driver.externalBankName ?? null,
          externalBankLast4: driver.externalBankLast4 ?? null,
        },
      });
    } catch (error) {
      const message = getErrorMessage(error);

      const failed = await prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: PayoutStatus.FAILED,
          failureReason: message.slice(0, 1000),
        },
        select: {
          id: true,
          status: true,
          providerRef: true,
          failureReason: true,
        },
      });

      console.error("[POST /api/admin/payouts/execute] stripe error:", error);

      return NextResponse.json(
        {
          ok: false,
          error: message,
          payout: {
            id: failed.id,
            status: failed.status,
            providerRef: failed.providerRef ?? null,
            failureReason: failed.failureReason ?? null,
          },
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("[POST /api/admin/payouts/execute] error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}