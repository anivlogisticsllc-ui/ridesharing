// app/api/mobile/rider/add-tip/route.ts

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import {
  PaymentType,
  RidePaymentStatus,
  TipStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { captureFinalCardPayment } from "@/lib/payments/captureFinalCardPayment";

const JWT_SECRET = process.env.MOBILE_JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("MOBILE_JWT_SECRET is not configured");
}

const secret = new TextEncoder().encode(JWT_SECRET);

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:8081",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type MobileJwtPayload = {
  sub?: string;
};

function isPositiveInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    Number.isInteger(value)
  );
}

async function getMobileUserId(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("authorization") || "";

  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();

  if (!token) {
    return null;
  }

  try {
    const verified = await jwtVerify(token, secret);
    const payload = verified.payload as MobileJwtPayload;

    return typeof payload.sub === "string" && payload.sub
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(req: NextRequest) {
  const riderId = await getMobileUserId(req);

  if (!riderId) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated" },
      { status: 401, headers: corsHeaders }
    );
  }

  const body = await req.json();

  const rideId =
    typeof body?.rideId === "string"
      ? body.rideId.trim()
      : "";

  const tipAmountCents = body?.tipAmountCents;
  const tipPercent = body?.tipPercent;

  if (!rideId) {
    return NextResponse.json(
      { ok: false, error: "Invalid rideId" },
      { status: 400, headers: corsHeaders }
    );
  }

  if (!isPositiveInt(tipAmountCents)) {
    return NextResponse.json(
      { ok: false, error: "Invalid tip amount" },
      { status: 400, headers: corsHeaders }
    );
  }

  if (
    tipPercent != null &&
    tipPercent !== 10 &&
    tipPercent !== 15 &&
    tipPercent !== 20
  ) {
    return NextResponse.json(
      { ok: false, error: "Invalid tip percent" },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    const payment = await prisma.ridePayment.findFirst({
      where: {
        rideId,
        riderId,
        paymentType: PaymentType.CARD,
        status: {
          in: [
            RidePaymentStatus.AUTHORIZED,
            RidePaymentStatus.PENDING,
          ],
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        tipStatus: true,
        tipEligibleUntil: true,
      },
    });

    if (!payment) {
      return NextResponse.json(
        { ok: false, error: "Payment not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    if (payment.tipStatus !== TipStatus.ELIGIBLE) {
      return NextResponse.json(
        { ok: false, error: "Tip not allowed" },
        { status: 400, headers: corsHeaders }
      );
    }

    if (
      payment.tipEligibleUntil &&
      payment.tipEligibleUntil.getTime() < Date.now()
    ) {
      return NextResponse.json(
        { ok: false, error: "Tip window expired" },
        { status: 400, headers: corsHeaders }
      );
    }

    await prisma.ridePayment.update({
      where: {
        id: payment.id,
      },
      data: {
        tipStatus: TipStatus.PENDING,
        tipAmountCents,
        tipPercent: tipPercent ?? null,
        tipSelectedAt: new Date(),
        tipSkippedAt: null,
        tipChargedAt: null,
        stripeTipChargeId: null,
      },
    });

    const capture = await captureFinalCardPayment({
      riderId,
      rideId,
    });

    if (!capture.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: capture.error,
          needsFallbackCharge: capture.needsFallbackCharge ?? false,
        },
        {
          status: capture.status,
          headers: corsHeaders,
        }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        capturedAmountCents: capture.capturedAmountCents,
        tipAmountCents: capture.tipAmountCents,
        totalAmountCents: capture.totalAmountCents,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (err) {
    console.error("Mobile tip selection error:", err);

    return NextResponse.json(
      { ok: false, error: "Failed to save tip" },
      { status: 500, headers: corsHeaders }
    );
  }
}