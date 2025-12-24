// pages/api/account/billing/driver.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import { prisma } from "../../../../lib/prisma";

type DriverBillingResponse =
  | {
      ok: true;
      payouts: {
        id: string;
        amountCents: number;
        currency: string;
        status: string;
        createdAt: string;
      }[];
      serviceFees: {
        totalFeesCents: number;
        currency: string;
        rideCount: number;
      };
    }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DriverBillingResponse>
) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const session = await getServerSession(req, res, authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    const role = (session?.user as any)?.role as "DRIVER" | "RIDER" | undefined;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (role !== "DRIVER") {
      return res.status(403).json({ ok: false, error: "Driver access only" });
    }

    // ---- Payout history ----
    const payouts = await prisma.payout.findMany({
      where: { driverId: userId }, // if your Payout uses relation instead, tell me and I’ll adjust
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        amountCents: true,
        currency: true,
        status: true,
        createdAt: true,
      },
    });

    // ---- Service fee summary (Phase 1) ----
    // Your Transaction model appears to have serviceFeeCents (NOT feeCents / amountCents)
    // and driver is a relation (NOT driverId)
    const feeAgg = await prisma.transaction.aggregate({
      where: {
        driver: { is: { id: userId } },
      },
      _sum: { serviceFeeCents: true },
      _count: { id: true },
    });

    return res.status(200).json({
      ok: true,
      payouts: payouts.map((p) => ({
        id: p.id,
        amountCents: p.amountCents,
        currency: p.currency,
        status: String(p.status),
        createdAt: p.createdAt.toISOString(),
      })),
      serviceFees: {
        totalFeesCents: feeAgg._sum.serviceFeeCents ?? 0,
        currency: "USD",
        rideCount: feeAgg._count.id,
      },
    });
  } catch (err: any) {
    console.error("Driver billing API error:", err);
    // Keep the UI clean; don't dump Prisma internals into the page
    return res.status(500).json({ ok: false, error: "Failed to load driver billing" });
  }
}
