// pages/api/rider/add-tip.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { PaymentType, RidePaymentStatus, TipStatus } from "@prisma/client";

type ApiResponse =
  | { ok: true }
  | { ok: false; error: string };

type SessionUser = {
  id?: string | null;
};

type RequestBody = {
  rideId?: string;
  tipAmountCents?: number;
  tipPercent?: number;
};

function isPositiveInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    Number.isInteger(value)
  );
}

function getBaseUrl(req: NextApiRequest): string {
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader || "http";

  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;

  if (!host) {
    return "http://localhost:3000";
  }

  return `${proto}://${host}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const user = session?.user as SessionUser | undefined;
  const riderId = typeof user?.id === "string" ? user.id : null;

  if (!riderId) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const { rideId, tipAmountCents, tipPercent } = (req.body ?? {}) as RequestBody;

  if (typeof rideId !== "string" || !rideId.trim()) {
    return res.status(400).json({ ok: false, error: "Invalid rideId" });
  }

  if (!isPositiveInt(tipAmountCents)) {
    return res.status(400).json({ ok: false, error: "Invalid tip amount" });
  }

  if (tipPercent != null && tipPercent !== 10 && tipPercent !== 15 && tipPercent !== 20) {
    return res.status(400).json({ ok: false, error: "Invalid tip percent" });
  }

  try {
    const payment = await prisma.ridePayment.findFirst({
      where: {
        rideId,
        riderId,
        paymentType: PaymentType.CARD,
        status: {
          in: [RidePaymentStatus.AUTHORIZED, RidePaymentStatus.PENDING],
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
      return res.status(404).json({ ok: false, error: "Payment not found" });
    }

    if (payment.tipStatus !== TipStatus.ELIGIBLE) {
      return res.status(400).json({ ok: false, error: "Tip not allowed" });
    }

    if (
      payment.tipEligibleUntil &&
      new Date(payment.tipEligibleUntil).getTime() < Date.now()
    ) {
      return res.status(400).json({ ok: false, error: "Tip window expired" });
    }

    await prisma.ridePayment.update({
      where: { id: payment.id },
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

    const baseUrl = getBaseUrl(req);

    const captureRes = await fetch(`${baseUrl}/api/rider/capture-final`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: req.headers.cookie ?? "",
      },
      body: JSON.stringify({ rideId }),
    });

    const captureJson = (await captureRes.json().catch(() => null)) as
      | { ok: true }
      | { ok: false; error: string }
      | null;

    if (!captureRes.ok || !captureJson?.ok) {
      return res.status(400).json({
        ok: false,
        error:
          captureJson?.ok === false
            ? captureJson.error
            : "Tip saved, but final capture failed",
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Tip selection error:", err);
    return res.status(500).json({ ok: false, error: "Failed to save tip" });
  }
}