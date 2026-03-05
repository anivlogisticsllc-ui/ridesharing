// app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import {
  MembershipPlan,
  MembershipStatus,
  MembershipType,
} from "@prisma/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

async function createMembershipRowFromSub(sub: any, userId: string, membershipType: MembershipType) {
  const start =
    toDateFromUnixSeconds(sub?.current_period_start) ?? new Date();

  const end =
    toDateFromUnixSeconds(sub?.current_period_end) ??
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const statusStr = String(sub?.status || "");
  const activeLike = statusStr === "active" || statusStr === "trialing";
  const status: MembershipStatus = activeLike
    ? MembershipStatus.ACTIVE
    : MembershipStatus.EXPIRED;

  // best-effort monthly cents:
  const unitAmount = sub?.items?.data?.[0]?.price?.unit_amount;
  const amountPaidCents =
    typeof unitAmount === "number" && Number.isFinite(unitAmount) && unitAmount > 0
      ? unitAmount
      : 0;

  const subId = typeof sub?.id === "string" ? sub.id : null;

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

async function refreshLatestMembershipFromSub(sub: any, userId: string, membershipType: MembershipType) {
  const end = toDateFromUnixSeconds(sub?.current_period_end);
  if (!end) return;

  const statusStr = String(sub?.status || "");
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

  const subId = typeof sub?.id === "string" ? sub.id : null;

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

async function expireLatestMembership(userId: string, membershipType: MembershipType) {
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

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return jsonError(500, "Missing STRIPE_WEBHOOK_SECRET");

  const sig = req.headers.get("stripe-signature");
  if (!sig) return jsonError(400, "Missing stripe-signature header");

  const rawBody = await req.text();

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    return jsonError(400, `Webhook signature verification failed: ${err?.message || "unknown error"}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data?.object as any;

        const subscriptionId =
          typeof session?.subscription === "string"
            ? session.subscription
            : typeof session?.subscription?.id === "string"
            ? session.subscription.id
            : null;

        const customerId =
          typeof session?.customer === "string"
            ? session.customer
            : typeof session?.customer?.id === "string"
            ? session.customer.id
            : null;

        const userId = String(session?.metadata?.userId || "");
        const membershipType = session?.metadata?.membershipType as unknown;

        if (!userId || !isMembershipType(membershipType)) break;

        if (customerId) {
          await prisma.user.update({
            where: { id: userId },
            data: { stripeCustomerId: customerId },
          });
        }

        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ["items.data.price"],
          });
          await createMembershipRowFromSub(sub, userId, membershipType);
        }

        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data?.object as any;

        const subscriptionId =
          typeof invoice?.subscription === "string"
            ? invoice.subscription
            : typeof invoice?.subscription?.id === "string"
            ? invoice.subscription.id
            : null;

        if (!subscriptionId) break;

        const sub = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ["items.data.price"],
        });

        const userId = String(sub?.metadata?.userId || "");
        const membershipType = sub?.metadata?.membershipType as unknown;

        if (!userId || !isMembershipType(membershipType)) break;

        await refreshLatestMembershipFromSub(sub, userId, membershipType);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data?.object as any;

        const userId = String(sub?.metadata?.userId || "");
        const membershipType = sub?.metadata?.membershipType as unknown;

        if (!userId || !isMembershipType(membershipType)) break;

        await expireLatestMembership(userId, membershipType);
        break;
      }

      default:
        break;
    }

    return jsonOk();
  } catch (err: any) {
    console.error("Stripe webhook handler error:", err?.message || err);
    return jsonError(500, "Webhook handler failed");
  }
}