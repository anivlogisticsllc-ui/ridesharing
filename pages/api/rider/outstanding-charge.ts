// pages/api/rider/outstanding-charge.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { UserRole } from "@prisma/client";

type ApiResponse =
  | {
      ok: true;
      outstanding: {
        id: string;
        status: string;
        totalCents: number;
        fareCents: number;
        convenienceFeeCents: number;
        currency: string;
        reason: string;
        note: string | null;
        createdAt: string;
        ride: {
          id: string;
          originCity: string;
          destinationCity: string;
          departureTime: string;
          tripCompletedAt: string | null;
        };
        driverName: string | null;
      };
    }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const user = session?.user as any;

    if (!user?.id) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const role = user.role;
    if (role !== UserRole.RIDER) {
      return res.status(403).json({ ok: false, error: "Only riders can view this." });
}
    const oc = typeof req.query.oc === "string" ? req.query.oc.trim() : "";
    if (!oc) return res.status(400).json({ ok: false, error: "Missing oc." });

    const row = await prisma.outstandingCharge.findFirst({
      where: { id: oc, riderId: String(user.id) },
      select: {
        id: true,
        status: true,
        totalCents: true,
        fareCents: true,
        convenienceFeeCents: true,
        currency: true,
        reason: true,
        note: true,
        createdAt: true,
        ride: {
          select: {
            id: true,
            originCity: true,
            destinationCity: true,
            departureTime: true,
            tripCompletedAt: true,
            driver: { select: { name: true } },
          },
        },
      },
    });

    if (!row) return res.status(404).json({ ok: false, error: "Outstanding charge not found." });

    return res.status(200).json({
      ok: true,
      outstanding: {
        id: row.id,
        status: row.status,
        totalCents: row.totalCents,
        fareCents: row.fareCents,
        convenienceFeeCents: row.convenienceFeeCents,
        currency: row.currency,
        reason: row.reason,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
        ride: {
          id: row.ride.id,
          originCity: row.ride.originCity,
          destinationCity: row.ride.destinationCity,
          departureTime: row.ride.departureTime.toISOString(),
          tripCompletedAt: row.ride.tripCompletedAt ? row.ride.tripCompletedAt.toISOString() : null,
        },
        driverName: row.ride.driver?.name ?? null,
      },
    });
  } catch (err) {
    console.error("[rider/outstanding-charge] error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}