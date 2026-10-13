// app/api/mobile/rider/skip-tip/route.ts

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

  if (!rideId) {
    return NextResponse.json(
      { ok: false, error: "Invalid rideId" },
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
      },
    });

    if (!payment) {
      return NextResponse.json(
        { ok: false, error: "Payment not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    if (
      payment.tipStatus !== TipStatus.ELIGIBLE &&
      payment.tipStatus !== TipStatus.PENDING
    ) {
      return NextResponse.json(
        { ok: false, error: "Tip cannot be skipped" },
        { status: 400, headers: corsHeaders }
      );
    }

    await prisma.ridePayment.update({
      where: {
        id: payment.id,
      },
      data: {
        tipStatus: TipStatus.SKIPPED,
        tipSkippedAt: new Date(),
        tipAmountCents: 0,
        tipPercent: null,
        tipSelectedAt: null,
      } as any,
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
        totalAmountCents: capture.totalAmountCents,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (err) {
    console.error("Mobile skip tip error:", err);

    return NextResponse.json(
      { ok: false, error: "Failed to skip tip" },
      { status: 500, headers: corsHeaders }
    );
  }
}