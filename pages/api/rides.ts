// pages/api/rides.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { prisma } from "../../lib/prisma";
import { MembershipType, RideStatus, PaymentType, BookingStatus } from "@prisma/client";
import { membershipErrorMessage, requireTrialOrActive } from "@/lib/guardMembership";

// ✅ add this import (adjust if your stripe export path differs)
import { stripe } from "@/lib/stripe";

type ApiResponse =
  | { ok: true; rides: any[] }
  | { ok: true; ride: any; booking?: any }
  | { ok: false; error: string; outstandingChargeId?: string };

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

function clampCashDiscountBps(bps: number) {
  if (!Number.isFinite(bps)) return 0;
  return Math.min(5000, Math.max(0, Math.round(bps)));
}

function computeReceipt(baseCents: number, cashDiscountBps: number) {
  const base = Number.isFinite(baseCents) ? Math.max(0, Math.round(baseCents)) : 0;
  const bps = clampCashDiscountBps(cashDiscountBps);
  const discountCents = bps > 0 ? Math.round(base * (bps / 10000)) : 0;
  const finalAmountCents = Math.max(0, base - discountCents);
  return { baseAmountCents: base, discountCents, finalAmountCents };
}

function applyCashDiscount(totalCents: number, cashDiscountBps: number) {
  if (!Number.isFinite(totalCents) || totalCents < 0) return totalCents;
  if (!Number.isFinite(cashDiscountBps) || cashDiscountBps <= 0) return totalCents;
  const bps = clampCashDiscountBps(cashDiscountBps);
  const discounted = Math.round(totalCents * (1 - bps / 10000));
  return Math.max(0, discounted);
}

function safeErrorMessage(err: unknown) {
  if (err instanceof Error && err.message) return err.message;
  return "Internal server error";
}

// ✅ NEW: require backup card on file (Stripe customer + default PM)
async function requireBackupCardOnFile(riderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({
    where: { id: riderId },
    select: { stripeCustomerId: true },
  });

  const customerId = user?.stripeCustomerId ?? null;
  if (!customerId) {
    return {
      ok: false,
      error: "A card is required before you can request rides. Please add a payment method in Billing.",
    };
  }

  const customer = await stripe.customers.retrieve(customerId);
  if (!customer || (customer as any).deleted) {
    return {
      ok: false,
      error: "Billing profile is missing. Please add a payment method in Billing.",
    };
  }

  const defaultPm = (customer as any)?.invoice_settings?.default_payment_method ?? null;
  if (!defaultPm) {
    return {
      ok: false,
      error: "A backup card is required before you can request rides. Please add a payment method in Billing.",
    };
  }

  return { ok: true };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  try {
    // ---------------- GET ----------------
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
        const cashDiscountBps =
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

    // ---------------- POST ----------------
    if (req.method === "POST") {
      const session = await getServerSession(req, res, authOptions);
      if (!session) return res.status(401).json({ ok: false, error: "Not authenticated" });

      const role = (session.user as any)?.role as "RIDER" | "DRIVER" | "ADMIN" | undefined;
      if (role !== "RIDER") return res.status(403).json({ ok: false, error: "Not a rider" });

      const riderId = (session.user as any)?.id as string | undefined;
      if (!riderId) return res.status(401).json({ ok: false, error: "Not authenticated" });

      // ✅ REMOVE Unpaid-balance lock (OutstandingCharge) — no longer used
      // (leave this block out entirely)

      // Membership gate (RIDER)
      const gate: any = await requireTrialOrActive({ userId: riderId, type: MembershipType.RIDER } as any);
      if (!gate || typeof gate.ok !== "boolean") {
        console.error("[api/rides] requireTrialOrActive returned invalid value:", gate);
        return res.status(500).json({ ok: false, error: "Membership gate failed unexpectedly (invalid response)." });
      }
      if (!gate.ok) {
        const msg = membershipErrorMessage(gate) || gate.error || "Membership required";
        return res.status(402).json({ ok: false, error: msg });
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

      // ✅ NEW: require backup card on file BEFORE any ride can be requested
      const cardGate = await requireBackupCardOnFile(riderId);
      if (!cardGate.ok) return res.status(402).json({ ok: false, error: cardGate.error });

      // Canonical pricing
      const totalPriceCents = Math.round((3 + 2 * distanceMiles) * 100);

      // Discount rule (10% for CASH)
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

          // inside prisma.$transaction(async (tx) => { ... })

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

                // "current" values (can change before trip starts)
                paymentType,
                cashDiscountBps,

                // "original" values (immutable audit trail)
                originalPaymentType: paymentType,
                originalCashDiscountBps: cashDiscountBps,

                paymentMethodId: null,
                currency: "usd",

                // receipt snapshot for THIS selection
                baseAmountCents: receipt.baseAmountCents,
                discountCents: receipt.discountCents,
                finalAmountCents: receipt.finalAmountCents,
              } as any,
            });

            return { ride, booking };
          }

          // Only allow changes if the trip hasn't started.
          // IMPORTANT: do NOT overwrite originalPaymentType/originalCashDiscountBps here.
          const updated = await tx.booking.updateMany({
            where: {
              id: existingBooking.id,
              riderId,
              ride: { tripStartedAt: null, status: { not: RideStatus.IN_ROUTE } },
            },
            data: {
              paymentType,
              cashDiscountBps,
              currency: "usd",

              baseAmountCents: receipt.baseAmountCents,
              discountCents: receipt.discountCents,
              finalAmountCents: receipt.finalAmountCents,
            } as any,
          });

          if (updated.count === 0) {
            const e = new Error("Payment can’t be changed after the trip has started.");
            (e as any).httpStatus = 409;
            throw e;
          }

          const booking = await tx.booking.findUnique({ where: { id: existingBooking.id } });
          return { ride, booking };
      });

      return res.status(201).json({ ok: true, ride, booking });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err: any) {
    const status = typeof err?.httpStatus === "number" ? err.httpStatus : 500;

    if (status !== 500) {
      return res.status(status).json({ ok: false, error: safeErrorMessage(err) });
    }

    console.error("[api/rides] unhandled error:", err);
    return res.status(500).json({
      ok: false,
      error: process.env.NODE_ENV === "development" ? safeErrorMessage(err) : "Internal server error",
    });
  }
}