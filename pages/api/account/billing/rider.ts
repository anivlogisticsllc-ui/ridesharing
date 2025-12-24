// pages/api/account/billing/rider.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import { prisma } from "../../../../lib/prisma";

type RiderBillingRow = {
  id: string;
  createdAt: string;
  status: string;
  currency: string;
  amountCents: number;

  ride: {
    id: string;
    departureTime: string | null;
    originCity: string | null;
    destinationCity: string | null;
    status: string | null;
  } | null;

  paymentMethod: {
    id: string;
    brand: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
    provider: string;
  } | null;
};

type RiderBillingResponse =
  | { ok: true; payments: RiderBillingRow[] }
  | { ok: false; error: string };

function toIso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RiderBillingResponse>
) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const session = await getServerSession(req, res, authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    const role = (session?.user as any)?.role as "RIDER" | "DRIVER" | undefined;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    // Keep it strict and predictable.
    if (role !== "RIDER") {
      return res.status(403).json({ ok: false, error: "Rider access only" });
    }

    // Optional pagination
    const take = Math.min(Number(req.query.take ?? 50) || 50, 200);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;

    const payments = await prisma.ridePayment.findMany({
      where: { riderId: userId },
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
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
        paymentMethod: {
          select: {
            id: true,
            provider: true,
            brand: true,
            last4: true,
            expMonth: true,
            expYear: true,
          },
        },
      },
    });

    const mapped: RiderBillingRow[] = payments.map((p) => ({
      id: p.id,
      createdAt: p.createdAt.toISOString(),
      status: String(p.status),
      currency: p.currency,
      amountCents: p.amountCents,
      ride: p.ride
        ? {
            id: p.ride.id,
            departureTime: toIso(p.ride.departureTime as any),
            originCity: (p.ride as any).originCity ?? null,
            destinationCity: (p.ride as any).destinationCity ?? null,
            status: (p.ride as any).status ?? null,
          }
        : null,
      paymentMethod: p.paymentMethod
        ? {
            id: p.paymentMethod.id,
            provider: p.paymentMethod.provider,
            brand: p.paymentMethod.brand,
            last4: p.paymentMethod.last4,
            expMonth: p.paymentMethod.expMonth,
            expYear: p.paymentMethod.expYear,
          }
        : null,
    }));

    return res.status(200).json({ ok: true, payments: mapped });
  } catch (err: any) {
    console.error("Rider billing API error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal error" });
  }
}
