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
      earningsSummary: {
        grossAmountCents: number;
        serviceFeeCents: number;
        netAmountCents: number;
        pendingNetAmountCents: number;
        paidNetAmountCents: number;
        rideCount: number;
      };
      transactions: {
        id: string;
        rideId: string;
        createdAt: string;
        status: string;
        grossAmountCents: number;
        serviceFeeCents: number;
        netAmountCents: number;
        ride: {
          id: string;
          departureTime: string | null;
          originCity: string | null;
          destinationCity: string | null;
          status: string | null;
        } | null;
      }[];
      membershipCharges: {
        id: string;
        amountCents: number;
        currency: string;
        status: string;
        createdAt: string;
        paidAt: string | null;
        failedAt: string | null;
      }[];
    }
  | { ok: false; error: string };

function toIso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

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
    const role = (session?.user as any)?.role as "DRIVER" | "ADMIN" | "RIDER" | undefined;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (role !== "DRIVER" && role !== "ADMIN") {
      return res.status(403).json({ ok: false, error: "Driver access only" });
    }

    const payouts = await prisma.payout.findMany({
      where: { driverId: userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        amountCents: true,
        currency: true,
        status: true,
        createdAt: true,
      },
    });

    const transactions = await prisma.transaction.findMany({
      where: { driverId: userId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        ride: {
          select: {
            id: true,
            departureTime: true,
            originCity: true,
            destinationCity: true,
            status: true,
          },
        },
      },
    });

    const summaryAgg = await prisma.transaction.aggregate({
      where: { driverId: userId },
      _sum: {
        grossAmountCents: true,
        serviceFeeCents: true,
        netAmountCents: true,
      },
      _count: { id: true },
    });

    const paidPayoutAmountCents = payouts
      .filter((p) => String(p.status).toUpperCase() === "PAID")
      .reduce((sum, p) => sum + p.amountCents, 0);

    const totalNetAmountCents = summaryAgg._sum.netAmountCents ?? 0;
    const pendingNetAmountCents = Math.max(0, totalNetAmountCents - paidPayoutAmountCents);

    const membershipCharges = await prisma.membershipCharge.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        amountCents: true,
        currency: true,
        status: true,
        createdAt: true,
        paidAt: true,
        failedAt: true,
      },
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
        totalFeesCents: summaryAgg._sum.serviceFeeCents ?? 0,
        currency: "USD",
        rideCount: summaryAgg._count.id,
      },
      earningsSummary: {
        grossAmountCents: summaryAgg._sum.grossAmountCents ?? 0,
        serviceFeeCents: summaryAgg._sum.serviceFeeCents ?? 0,
        netAmountCents: totalNetAmountCents,
        pendingNetAmountCents,
        paidNetAmountCents: paidPayoutAmountCents,
        rideCount: summaryAgg._count.id,
      },
      transactions: transactions.map((t) => ({
        id: t.id,
        rideId: t.rideId,
        createdAt: t.createdAt.toISOString(),
        status: String(t.status),
        grossAmountCents: t.grossAmountCents,
        serviceFeeCents: t.serviceFeeCents,
        netAmountCents: t.netAmountCents,
        ride: t.ride
          ? {
              id: t.ride.id,
              departureTime: toIso(t.ride.departureTime as any),
              originCity: (t.ride as any).originCity ?? null,
              destinationCity: (t.ride as any).destinationCity ?? null,
              status: (t.ride as any).status ?? null,
            }
          : null,
      })),
      membershipCharges: membershipCharges.map((c) => ({
        id: c.id,
        amountCents: c.amountCents,
        currency: c.currency,
        status: String(c.status),
        createdAt: c.createdAt.toISOString(),
        paidAt: toIso(c.paidAt),
        failedAt: toIso(c.failedAt),
      })),
    });
  } catch (err: any) {
    console.error("Driver billing API error:", err);
    return res.status(500).json({ ok: false, error: "Failed to load driver billing" });
  }
}