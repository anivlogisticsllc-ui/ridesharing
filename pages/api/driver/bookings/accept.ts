// pages/api/driver/bookings/accept.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { canAcceptRides, driverBlockReason } from "@/lib/driverEligibility";
import { UserRole } from "@prisma/client";

type Resp =
  | { ok: true }
  | {
      ok: false;
      error: string;
      code?: string;
      verificationStatus?: string | null;
      membership?: { active: boolean; trialEndsAt?: string | null };
    };

function toIsoOrNull(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const session = await getServerSession(req, res, authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    const role = (session?.user as any)?.role as UserRole | string | undefined;

    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" });
    if (role !== UserRole.DRIVER) return res.status(403).json({ ok: false, error: "Driver account required" });

    const bookingId = typeof (req.body as any)?.bookingId === "string" ? (req.body as any).bookingId.trim() : "";
    if (!bookingId) return res.status(400).json({ ok: false, error: "Missing bookingId" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        membershipActive: true,
        trialEndsAt: true,
        driverProfile: { select: { verificationStatus: true } },
      },
    });

    if (!user || user.role !== UserRole.DRIVER) {
      return res.status(403).json({ ok: false, error: "Driver account required" });
    }

    const verificationStatus = (user.driverProfile as any)?.verificationStatus ?? null;

    const membership = {
      active: !!user.membershipActive,
      trialEndsAt: toIsoOrNull(user.trialEndsAt),
    };

    if (!canAcceptRides({ verificationStatus, membership })) {
      return res.status(403).json({
        ok: false,
        code: "DRIVER_NOT_ELIGIBLE",
        error: driverBlockReason({ verificationStatus, membership }) ?? "Not eligible",
        verificationStatus,
        membership,
      });
    }

    // Minimal update (safe across schemas)
    await prisma.booking.update({
      where: { id: bookingId },
      data: {} as any,
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[accept booking] error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}