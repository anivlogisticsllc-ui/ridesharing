// pages/api/rides.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { prisma } from "../../lib/prisma";
import { BookingStatus, PaymentType, RideStatus, UserRole } from "@prisma/client";
import { membershipErrorMessage, requireTrialOrActive } from "@/lib/guardMembership";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

type ApiResponse =
  | { ok: true; rides: any[] }
  | { ok: true; ride: any; booking?: any }
  | { ok: false; error: string };

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parsePaymentType(v: unknown): PaymentType | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  if (s === "CARD") return PaymentType.CARD;
  if (s === "CASH") return PaymentType.CASH;
  return null;
}

function parseClientRequestId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const id = v.trim();
  return id.length >= 8 ? id : null;
}

function computeReceipt(baseCents: number, cashDiscountBps: number) {
  const base = Number.isFinite(baseCents) ? Math.max(0, Math.round(baseCents)) : 0;
  const bps = Number.isFinite(cashDiscountBps) ? Math.max(0, Math.min(5000, Math.round(cashDiscountBps))) : 0;
  const discountCents = bps > 0 ? Math.round(base * (bps / 10000)) : 0;
  const finalAmountCents = Math.max(0, base - discountCents);
  return { baseAmountCents: base, discountCents, finalAmountCents };
}

function applyCashDiscount(totalCents: number, cashDiscountBps: number) {
  if (!Number.isFinite(totalCents) || totalCents < 0) return totalCents;
  if (!Number.isFinite(cashDiscountBps) || cashDiscountBps <= 0) return totalCents;
  const bps = Math.max(0, Math.min(5000, Math.round(cashDiscountBps)));
  const discounted = Math.round(totalCents * (1 - bps / 10000));
  return Math.max(0, discounted);
}

async function findCardOnFile(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // 1) DB default first
  const dbDefault = await prisma.paymentMethod.findFirst({
    where: { userId, isDefault: true },
    select: { id: true, stripePaymentMethodId: true },
  });

  if (dbDefault?.stripePaymentMethodId) return { ok: true };

  // 2) Stripe fallback + self-heal DB
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });

  const customerId = user?.stripeCustomerId ?? null;
  if (!customerId) {
    return { ok: false, error: "A card is required. Please add a payment method in Billing." };
  }

  const customer = await stripe.customers.retrieve(customerId);
  if (!customer || (customer as any).deleted) {
    return { ok: false, error: "Billing profile is missing. Please add a payment method in Billing." };
  }

  const defaultPm = (customer as Stripe.Customer).invoice_settings?.default_payment_method;
  const defaultPmId =
    typeof defaultPm === "string" ? defaultPm : typeof (defaultPm as any)?.id === "string" ? (defaultPm as any).id : null;

  let pmId: string | null = defaultPmId;

  if (!pmId) {
    const list = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
    pmId = list.data?.[0]?.id ?? null;
  }

  if (!pmId) {
    return { ok: false, error: "A card is required. Please add a payment method in Billing." };
  }

  // Ensure default on Stripe
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pmId } });

  const pm = await stripe.paymentMethods.retrieve(pmId);
  if (!pm || pm.type !== "card" || !pm.card) {
    return { ok: false, error: "A card is required. Please add a payment method in Billing." };
  }

  // Self-heal DB so future checks are fast
  await prisma.$transaction(async (tx) => {
    await tx.paymentMethod.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });

    await tx.paymentMethod.upsert({
      // assumes stripePaymentMethodId is unique in schema
      where: { stripePaymentMethodId: pmId },
      create: {
        userId,
        provider: "STRIPE",
        stripePaymentMethodId: pmId,
        brand: pm.card?.brand ?? null,
        last4: pm.card?.last4 ?? null,
        expMonth: pm.card?.exp_month ?? null,
        expYear: pm.card?.exp_year ?? null,
        isDefault: true,
      } as any,
      update: {
        userId,
        provider: "STRIPE",
        brand: pm.card?.brand ?? null,
        last4: pm.card?.last4 ?? null,
        expMonth: pm.card?.exp_month ?? null,
        expYear: pm.card?.exp_year ?? null,
        isDefault: true,
      } as any,
    });

    await tx.user.update({
      where: { id: userId },
      data: { stripeDefaultPaymentId: pmId },
    });
  });

  return { ok: true };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  try {
    // ---------- GET ----------
    if (req.method === "GET") {
      const session = await getServerSession(req, res, authOptions);
      const mine = req.query.mine === "1";

      if (mine) {
        if (!session) return res.status(401).json({ ok: false, error: "Not authenticated" });

        const userId = (session.user as any)?.id as string | undefined;
        if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" });

        const rides = await prisma.ride.findMany({
          where: { riderId: userId },
          orderBy: { departureTime: "asc" },
        });

        return res.status(200).json({ ok: true, rides });
      }

      const rides = await prisma.ride.findMany({
        where: { status: RideStatus.OPEN, driverId: null },
        orderBy: { departureTime: "asc" },
        include: {
          bookings: {
            where: { status: BookingStatus.PENDING },
            select: { id: true, paymentType: true, cashDiscountBps: true },
            take: 1,
          },
        },
      });

      const normalized = rides.map((r) => {
        const b = (r as any).bookings?.[0] ?? null;
        const paymentType: PaymentType | null = b?.paymentType ?? null;
        const cashDiscountBps: number =
          typeof b?.cashDiscountBps === "number" && Number.isFinite(b.cashDiscountBps) ? b.cashDiscountBps : 0;

        const baseTotalCents: number = (r as any).totalPriceCents ?? 0;
        const displayTotalCents =
          paymentType === PaymentType.CASH ? applyCashDiscount(baseTotalCents, cashDiscountBps) : baseTotalCents;

        return {
          ...r,
          paymentType,
          cashDiscountBps,
          displayTotalCents,
          pendingBookingId: b?.id ?? null,
          bookings: undefined,
        };
      });

      return res.status(200).json({ ok: true, rides: normalized });
    }

    // ---------- POST ----------
    if (req.method === "POST") {
      const session = await getServerSession(req, res, authOptions);
      if (!session) return res.status(401).json({ ok: false, error: "Not authenticated" });

      const role = (session.user as any)?.role as "RIDER" | "DRIVER" | "ADMIN" | undefined;
      if (role !== "RIDER") return res.status(403).json({ ok: false, error: "Not a rider" });

      const riderId = (session.user as any)?.id as string | undefined;
      if (!riderId) return res.status(401).json({ ok: false, error: "Not authenticated" });

      // Membership gate (source of truth = membership table)
      const gate = await requireTrialOrActive({ userId: riderId, role: UserRole.RIDER });
      if (!gate.ok) {
        return res.status(402).json({ ok: false, error: membershipErrorMessage(gate) });
      }

      const body: any = req.body ?? {};
      const clientRequestId = parseClientRequestId(body.clientRequestId);
      if (!clientRequestId) return res.status(400).json({ ok: false, error: "Missing/invalid clientRequestId." });

      const originCity = body.originCity ? String(body.originCity) : "";
      const destinationCity = body.destinationCity ? String(body.destinationCity) : "";
      const departureTimeRaw = body.departureTime ? String(body.departureTime) : "";

      const originLat = toNumber(body.originLat);
      const originLng = toNumber(body.originLng);
      const destinationLat = toNumber(body.destinationLat);
      const destinationLng = toNumber(body.destinationLng);

      const passengerCount =
        typeof body.passengerCount === "number" && Number.isFinite(body.passengerCount) ? body.passengerCount : 1;

      const distanceMiles = toNumber(body.distanceMiles);
      const paymentType = parsePaymentType(body.paymentType);

      if (!paymentType) return res.status(400).json({ ok: false, error: "Missing/invalid paymentType (CARD or CASH)." });
      if (!originCity || !destinationCity || !departureTimeRaw || distanceMiles == null) {
        return res.status(400).json({ ok: false, error: "Missing fields" });
      }

      const departureTime = new Date(departureTimeRaw);
      if (Number.isNaN(departureTime.getTime())) {
        return res.status(400).json({ ok: false, error: "Invalid departureTime" });
      }

      if (originLat == null || originLng == null || destinationLat == null || destinationLng == null) {
        return res.status(400).json({
          ok: false,
          error: "Missing coordinates (originLat/originLng/destinationLat/destinationLng).",
        });
      }

      // CARD RULES (your design)
      const isTrial = gate.ok && gate.state === "TRIAL";

      const mustHaveCard =
        paymentType === PaymentType.CARD ||
        (paymentType === PaymentType.CASH && isTrial);

      if (mustHaveCard) {
        const cardGate = await findCardOnFile(riderId);
        if (!cardGate.ok) return res.status(402).json({ ok: false, error: cardGate.error });
      }

      // Canonical pricing
      const totalPriceCents = Math.round((3 + 2 * distanceMiles) * 100);

      // 10% discount for CASH
      const cashDiscountBps = paymentType === PaymentType.CASH ? 1000 : 0;

      const receipt =
        paymentType === PaymentType.CASH
          ? computeReceipt(totalPriceCents, cashDiscountBps)
          : { baseAmountCents: totalPriceCents, discountCents: 0, finalAmountCents: totalPriceCents };

      const { ride, booking } = await prisma.$transaction(async (tx) => {
        const ride = await tx.ride.upsert({
          where: { clientRequestId },
          update: {
            riderId,
            originCity,
            originLat,
            originLng,
            destinationCity,
            destinationLat,
            destinationLng,
            departureTime,
            passengerCount,
            distanceMiles,
            totalPriceCents,
            status: RideStatus.OPEN,
          },
          create: {
            clientRequestId,
            riderId,
            originCity,
            originLat,
            originLng,
            destinationCity,
            destinationLat,
            destinationLng,
            departureTime,
            passengerCount,
            distanceMiles,
            totalPriceCents,
            status: RideStatus.OPEN,
          },
        });

        const existingBooking = await tx.booking.findFirst({
          where: { rideId: ride.id, riderId },
          orderBy: { createdAt: "asc" as any },
          select: { id: true },
        });

        if (!existingBooking) {
          const booking = await tx.booking.create({
            data: {
              rideId: ride.id,
              riderId,
              status: BookingStatus.PENDING,

              paymentType,
              cashDiscountBps,

              // If your schema has these fields, keep them. If not, remove them.
              originalPaymentType: paymentType,
              originalCashDiscountBps: cashDiscountBps,

              paymentMethodId: null,
              currency: "usd",

              baseAmountCents: receipt.baseAmountCents,
              discountCents: receipt.discountCents,
              finalAmountCents: receipt.finalAmountCents,
            } as any,
          });

          return { ride, booking };
        }

        const updated = await tx.booking.update({
          where: { id: existingBooking.id },
          data: {
            paymentType,
            cashDiscountBps,
            currency: "usd",
            baseAmountCents: receipt.baseAmountCents,
            discountCents: receipt.discountCents,
            finalAmountCents: receipt.finalAmountCents,
          } as any,
        });

        return { ride, booking: updated };
      });

      return res.status(201).json({ ok: true, ride, booking });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err: any) {
    console.error("[api/rides] unhandled error:", err);
    return res.status(500).json({
      ok: false,
      error: process.env.NODE_ENV === "development" && err?.message ? err.message : "Internal server error",
    });
  }
}