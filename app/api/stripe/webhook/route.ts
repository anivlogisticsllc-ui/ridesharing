// OATH: Clean replacement file
// FILE: app/api/stripe/webhook/route.ts

import { NextResponse } from "next/server";
import Stripe from "stripe";

import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import {
  MembershipPlan,
  MembershipStatus,
  MembershipType,
  RefundStatus,
  RidePaymentStatus,
} from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StripeSubLike = {
  id?: string | null;
  status?: string | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  metadata?: Record<string, string>;
  items?: {
    data?: Array<{
      price?: {
        unit_amount?: number | null;
      } | null;
    }>;
  } | null;
};

type StripeInvoiceLike = {
  subscription?: string | { id?: string | null } | null;
};

type StripeCheckoutSessionLike = {
  subscription?: string | { id?: string | null } | null;
  customer?: string | { id?: string | null } | null;
  metadata?: Record<string, string>;
};

function jsonOk() {
  return NextResponse.json({ ok: true });
}

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function isMembershipType(v: unknown): v is MembershipType {
  return v === MembershipType.RIDER || v === MembershipType.DRIVER;
}

function toDateFromUnixSeconds(v: unknown): Date | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return new Date(v * 1000);
}

function toNonNegativeCents(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(0, Math.round(v));
  }

  if (typeof v === "string" && v.trim() !== "") {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }

  return 0;
}

function normalizeRefundStatus(
  status: string | null | undefined
): RefundStatus {
  const s = String(status || "").toLowerCase();

  if (s === "succeeded") return RefundStatus.SUCCEEDED;
  if (s === "failed" || s === "canceled") return RefundStatus.FAILED;

  return RefundStatus.PENDING;
}

async function resolveProcessorFeeLostCentsFromChargeRefund(args: {
  refund: Stripe.Refund;
}): Promise<number | null> {
  const refundAmountCents = toNonNegativeCents(args.refund.amount);
  if (refundAmountCents <= 0) return null;

  const chargeId =
    typeof args.refund.charge === "string"
      ? args.refund.charge
      : args.refund.charge?.id ?? null;

  if (!chargeId) return null;

  const charge = await stripe.charges.retrieve(chargeId, {
    expand: ["balance_transaction"],
  });

  const chargeAmountCents = toNonNegativeCents(charge.amount);
  if (chargeAmountCents <= 0) return null;

  const balanceTransaction = charge.balance_transaction;
  if (!balanceTransaction || typeof balanceTransaction === "string") {
    return null;
  }

  const originalChargeFeeCents = toNonNegativeCents(balanceTransaction.fee);

  if (originalChargeFeeCents <= 0) {
    return 0;
  }

  return Math.max(
    0,
    Math.round((originalChargeFeeCents * refundAmountCents) / chargeAmountCents)
  );
}

async function setUserMembershipFlags(userId: string, active: boolean) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      membershipActive: active,
      membershipPlan: "STANDARD",
      trialEndsAt: null,
    },
  });
}

async function createMembershipRowFromSub(
  sub: StripeSubLike,
  userId: string,
  membershipType: MembershipType
) {
  const start =
    toDateFromUnixSeconds(sub.current_period_start) ?? new Date();

  const end =
    toDateFromUnixSeconds(sub.current_period_end) ??
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const statusStr = String(sub.status || "");
  const activeLike = statusStr === "active" || statusStr === "trialing";
  const status: MembershipStatus = activeLike
    ? MembershipStatus.ACTIVE
    : MembershipStatus.EXPIRED;

  const unitAmount = sub.items?.data?.[0]?.price?.unit_amount;
  const amountPaidCents =
    typeof unitAmount === "number" &&
    Number.isFinite(unitAmount) &&
    unitAmount > 0
      ? unitAmount
      : 0;

  const subId = typeof sub.id === "string" ? sub.id : null;

  await prisma.membership.create({
    data: {
      userId,
      type: membershipType,
      startDate: start,
      expiryDate: end,
      status,
      amountPaidCents,
      paymentProvider: "STRIPE",
      paymentRef: subId ?? undefined,
      plan: MembershipPlan.STANDARD,
    },
  });

  await setUserMembershipFlags(userId, status === MembershipStatus.ACTIVE);
}

async function refreshLatestMembershipFromSub(
  sub: StripeSubLike,
  userId: string,
  membershipType: MembershipType
) {
  const end = toDateFromUnixSeconds(sub.current_period_end);
  if (!end) return;

  const statusStr = String(sub.status || "");
  const activeLike = statusStr === "active" || statusStr === "trialing";
  const status: MembershipStatus = activeLike
    ? MembershipStatus.ACTIVE
    : MembershipStatus.EXPIRED;

  const latest = await prisma.membership.findFirst({
    where: { userId, type: membershipType },
    orderBy: { startDate: "desc" },
    select: { id: true },
  });

  if (!latest) {
    await createMembershipRowFromSub(sub, userId, membershipType);
    return;
  }

  const subId = typeof sub.id === "string" ? sub.id : null;

  await prisma.membership.update({
    where: { id: latest.id },
    data: {
      expiryDate: end,
      status,
      paymentProvider: "STRIPE",
      paymentRef: subId ?? undefined,
    },
  });

  await setUserMembershipFlags(userId, status === MembershipStatus.ACTIVE);
}

async function expireLatestMembership(
  userId: string,
  membershipType: MembershipType
) {
  const latest = await prisma.membership.findFirst({
    where: { userId, type: membershipType },
    orderBy: { startDate: "desc" },
    select: { id: true },
  });

  if (latest) {
    await prisma.membership.update({
      where: { id: latest.id },
      data: { status: MembershipStatus.EXPIRED },
    });
  }

  await setUserMembershipFlags(userId, false);
}

async function findRidePaymentForRefund(refund: Stripe.Refund) {
  const metadata = refund.metadata ?? {};
  const ridePaymentId =
    typeof metadata.ridePaymentId === "string" && metadata.ridePaymentId.trim()
      ? metadata.ridePaymentId.trim()
      : null;

  if (ridePaymentId) {
    const byId = await prisma.ridePayment.findUnique({
      where: { id: ridePaymentId },
      select: {
        id: true,
        finalAmountCents: true,
        amountCents: true,
      },
    });

    if (byId) return byId;
  }

  const refundId = typeof refund.id === "string" ? refund.id : null;
  if (refundId) {
    const byExistingRefund = await prisma.refund.findFirst({
      where: { providerRef: refundId },
      select: {
        ridePaymentId: true,
        ridePayment: {
          select: {
            id: true,
            finalAmountCents: true,
            amountCents: true,
          },
        },
      },
    });

    if (byExistingRefund?.ridePayment) {
      return byExistingRefund.ridePayment;
    }
  }

  const chargeId =
    typeof refund.charge === "string"
      ? refund.charge
      : refund.charge?.id ?? null;

  if (chargeId) {
    const byCharge = await prisma.ridePayment.findFirst({
      where: { stripeChargeId: chargeId },
      select: {
        id: true,
        finalAmountCents: true,
        amountCents: true,
      },
      orderBy: { createdAt: "desc" },
    });

    if (byCharge) return byCharge;
  }

  const paymentIntentId =
    typeof refund.payment_intent === "string"
      ? refund.payment_intent
      : refund.payment_intent?.id ?? null;

  if (paymentIntentId) {
    const byPaymentIntent = await prisma.ridePayment.findFirst({
      where: { stripePaymentIntentId: paymentIntentId },
      select: {
        id: true,
        finalAmountCents: true,
        amountCents: true,
      },
      orderBy: { createdAt: "desc" },
    });

    if (byPaymentIntent) return byPaymentIntent;
  }

  return null;
}

async function syncRidePaymentRefundStatus(ridePaymentId: string) {
  const ridePayment = await prisma.ridePayment.findUnique({
    where: { id: ridePaymentId },
    select: {
      id: true,
      finalAmountCents: true,
      amountCents: true,
      refunds: {
        where: { status: RefundStatus.SUCCEEDED },
        select: { amountCents: true },
      },
    },
  });

  if (!ridePayment) return;

  const originalAmount =
    toNonNegativeCents(ridePayment.finalAmountCents) ||
    toNonNegativeCents(ridePayment.amountCents);

  const refundedTotal = ridePayment.refunds.reduce(
    (sum, r) => sum + toNonNegativeCents(r.amountCents),
    0
  );

  const nextStatus =
    originalAmount > 0 && refundedTotal >= originalAmount
      ? RidePaymentStatus.REFUNDED
      : RidePaymentStatus.SUCCEEDED;

  await prisma.ridePayment.update({
    where: { id: ridePayment.id },
    data: { status: nextStatus },
  });
}

async function syncRefundFromStripe(refund: Stripe.Refund) {
  const refundId = typeof refund.id === "string" ? refund.id : null;
  if (!refundId) return;

  const processorFeeLostCents =
    await resolveProcessorFeeLostCentsFromChargeRefund({ refund });

  const ridePayment = await findRidePaymentForRefund(refund);
  if (!ridePayment) {
    console.warn(
      "[stripe webhook] refund received but no matching RidePayment found:",
      refundId
    );
    return;
  }

  const currency = String(refund.currency || "usd").toUpperCase();
  const amountCents = toNonNegativeCents(refund.amount);
  const status = normalizeRefundStatus(refund.status);

  const pendingRow = await prisma.refund.findFirst({
    where: {
      ridePaymentId: ridePayment.id,
      provider: "STRIPE",
      status: RefundStatus.PENDING,
      amountCents,
    },
    orderBy: { createdAt: "desc" },
  });

  const existingExactRow = await prisma.refund.findFirst({
    where: {
      providerRef: refundId,
    },
  });

  if (existingExactRow) {
    await prisma.refund.update({
      where: { id: existingExactRow.id },
      data: {
        status,
        amountCents,
        currency,
        provider: "STRIPE",
        ...(processorFeeLostCents != null
          ? { processorFeeLostCents }
          : {}),
      },
    });
  } else if (pendingRow) {
    await prisma.refund.update({
      where: { id: pendingRow.id },
      data: {
        providerRef: refundId,
        status,
        amountCents,
        currency,
        provider: "STRIPE",
        ...(processorFeeLostCents != null
          ? { processorFeeLostCents }
          : {}),
      },
    });
  } else {
    await prisma.refund.create({
      data: {
        ridePaymentId: ridePayment.id,
        amountCents,
        currency,
        status,
        provider: "STRIPE",
        providerRef: refundId,
        processorFeeLostCents,
      },
    });
  }

  await syncRidePaymentRefundStatus(ridePayment.id);

  const metadata = refund.metadata ?? {};
  const disputeId =
    typeof metadata.disputeId === "string" && metadata.disputeId.trim()
      ? metadata.disputeId.trim()
      : null;

  if (disputeId && status === RefundStatus.SUCCEEDED) {
    await prisma.dispute.updateMany({
      where: { id: disputeId },
      data: {
        refundIssued: true,
        refundAmountCents: amountCents,
        refundIssuedAt: new Date(),
      },
    });
  }
}

async function syncRefundsFromCharge(charge: Stripe.Charge) {
  const refunds = charge.refunds?.data ?? [];
  for (const refund of refunds) {
    await syncRefundFromStripe(refund);
  }
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return jsonError(500, "Missing STRIPE_WEBHOOK_SECRET");

  const sig = req.headers.get("stripe-signature");
  if (!sig) return jsonError(400, "Missing stripe-signature header");

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    return jsonError(
      400,
      `Webhook signature verification failed: ${message}`
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as StripeCheckoutSessionLike;

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;

        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id ?? null;

        const userId = String(session.metadata?.userId || "");
        const membershipType = session.metadata?.membershipType as unknown;

        if (!userId || !isMembershipType(membershipType)) break;

        if (customerId) {
          await prisma.user.update({
            where: { id: userId },
            data: { stripeCustomerId: customerId },
          });
        }

        if (subscriptionId) {
          const sub = (await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ["items.data.price"],
          })) as unknown as StripeSubLike;

          await createMembershipRowFromSub(sub, userId, membershipType);
        }

        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as StripeInvoiceLike;

        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id ?? null;

        if (!subscriptionId) break;

        const sub = (await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ["items.data.price"],
        })) as unknown as StripeSubLike;

        const userId = String(sub.metadata?.userId || "");
        const membershipType = sub.metadata?.membershipType as unknown;

        if (!userId || !isMembershipType(membershipType)) break;

        await refreshLatestMembershipFromSub(sub, userId, membershipType);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as StripeSubLike;

        const userId = String(sub.metadata?.userId || "");
        const membershipType = sub.metadata?.membershipType as unknown;

        if (!userId || !isMembershipType(membershipType)) break;

        await expireLatestMembership(userId, membershipType);
        break;
      }

      case "refund.created":
      case "refund.updated":
      case "refund.failed": {
        const refund = event.data.object as Stripe.Refund;
        await syncRefundFromStripe(refund);
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        await syncRefundsFromCharge(charge);
        break;
      }

      default:
        break;
    }

    return jsonOk();
  } catch (err: unknown) {
    console.error(
      "Stripe webhook handler error:",
      err instanceof Error ? err.message : err
    );
    return jsonError(500, "Webhook handler failed");
  }
}