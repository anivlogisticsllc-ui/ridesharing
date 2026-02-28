// pages/api/driver/book-ride.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

type Resp = { ok: true } | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  try {
    // If this endpoint is supposed to be POST-only, keep this:
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const session = await getServerSession(req, res, authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" });

    // ✅ Driver verification gate
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
      select: { verificationStatus: true },
    });

    if (!profile) {
      return res.status(403).json({
        ok: false,
        error: "Driver profile missing. Complete driver setup first.",
      });
    }

    if (profile.verificationStatus !== "APPROVED") {
      return res.status(403).json({
        ok: false,
        error: `Driver verification required to book rides. Status: ${profile.verificationStatus}`,
      });
    }

    // TODO: your actual booking logic goes here
    // If you already have the booking logic in this file, paste it below this gate.

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error("[book-ride] error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}