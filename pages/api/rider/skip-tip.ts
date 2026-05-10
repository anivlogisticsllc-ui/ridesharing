// pages/api/rider/skip-tip.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { PaymentType, RidePaymentStatus, TipStatus } from "@prisma/client";

type ApiResponse =
  | { ok: true }
  | { ok: false; error: string };

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
  const riderId =
    typeof (session?.user as { id?: unknown } | undefined)?.id === "string"
      ? (session?.user as { id: string }).id
      : null;

  if (!riderId) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const { rideId } = req.body as { rideId?: string };

  if (!rideId || typeof rideId !== "string") {
    return res.status(400).json({ ok: false, error: "Invalid rideId" });
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
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        tipStatus: true,
      },
    });

    if (!payment) {
      return res.status(404).json({ ok: false, error: "Payment not found" });
    }

    // Allow skip for ELIGIBLE and also for already-expired-but-still-open states.
    // Only block if tip flow is already finalized one way or another.
    if (
      payment.tipStatus !== TipStatus.ELIGIBLE &&
      payment.tipStatus !== TipStatus.PENDING
    ) {
      return res.status(400).json({ ok: false, error: "Tip cannot be skipped" });
    }

    await prisma.ridePayment.update({
      where: { id: payment.id },
      data: {
        tipStatus: TipStatus.SKIPPED,
        tipSkippedAt: new Date(),
        tipAmountCents: 0,
        tipPercent: null,
        tipSelectedAt: null,
      } as any,
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
            : "Tip skipped, but final capture failed",
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Skip tip error:", err);
    return res.status(500).json({ ok: false, error: "Failed to skip tip" });
  }
}