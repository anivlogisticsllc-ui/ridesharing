// pages/api/admin/membership/extend-trial.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

type Resp =
  | { ok: true; userId: string; trialEndsAt: string }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const role = (session.user as any)?.role as string | undefined;
  if (role !== "ADMIN") return res.status(403).json({ ok: false, error: "Admin only" });

  const { userId, days } = (req.body ?? {}) as { userId?: unknown; days?: unknown };

  const safeUserId = typeof userId === "string" ? userId.trim() : "";
  const safeDays =
    typeof days === "number" && Number.isFinite(days) ? Math.floor(days) : 30;

  if (!safeUserId) return res.status(400).json({ ok: false, error: "Missing userId" });
  if (safeDays <= 0 || safeDays > 365)
    return res.status(400).json({ ok: false, error: "Invalid days" });

  const u = await prisma.user.findUnique({
    where: { id: safeUserId },
    select: { id: true, trialEndsAt: true },
  });
  if (!u) return res.status(404).json({ ok: false, error: "User not found" });

  const now = new Date();
  const base = u.trialEndsAt && u.trialEndsAt.getTime() > now.getTime() ? u.trialEndsAt : now;
  const next = new Date(base.getTime() + safeDays * 24 * 60 * 60 * 1000);

  const updated = await prisma.user.update({
    where: { id: safeUserId },
    data: { trialEndsAt: next },
    select: { id: true, trialEndsAt: true },
  });

  return res.status(200).json({
    ok: true,
    userId: updated.id,
    trialEndsAt: updated.trialEndsAt?.toISOString() ?? next.toISOString(),
  });
}
