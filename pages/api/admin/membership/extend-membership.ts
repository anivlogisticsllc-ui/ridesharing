// pages/api/admin/membership/extend-membership.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { MembershipStatus, MembershipType } from "@prisma/client";

type ExtendType = "RIDER" | "DRIVER" | "BOTH";

type Resp =
  | { ok: true; userId: string; updated: Array<{ type: MembershipType; expiryDate: string }> }
  | { ok: false; error: string };

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const role = (session.user as any)?.role as string | undefined;
  if (role !== "ADMIN") return res.status(403).json({ ok: false, error: "Admin only" });

  const body = (req.body ?? {}) as { userId?: unknown; days?: unknown; type?: unknown };

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const days =
    typeof body.days === "number" && Number.isFinite(body.days) ? Math.floor(body.days) : 30;
  const type = typeof body.type === "string" ? (body.type.toUpperCase() as ExtendType) : "BOTH";

  if (!userId) return res.status(400).json({ ok: false, error: "Missing userId" });
  if (days <= 0 || days > 365) return res.status(400).json({ ok: false, error: "Invalid days" });
  if (type !== "RIDER" && type !== "DRIVER" && type !== "BOTH")
    return res.status(400).json({ ok: false, error: "Invalid type" });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return res.status(404).json({ ok: false, error: "User not found" });

  const types: MembershipType[] =
    type === "BOTH"
      ? [MembershipType.RIDER, MembershipType.DRIVER]
      : [type === "DRIVER" ? MembershipType.DRIVER : MembershipType.RIDER];

  const updated = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const results: Array<{ type: MembershipType; expiryDate: string }> = [];

    for (const t of types) {
      const latest = await tx.membership.findFirst({
        where: { userId, type: t },
        orderBy: { startDate: "desc" },
        select: { id: true, startDate: true, expiryDate: true },
      });

      const base =
        latest?.expiryDate && latest.expiryDate.getTime() > now.getTime() ? latest.expiryDate : now;
      const nextExpiry = addDays(base, days);

      // If no membership row exists, create one.
      // If it exists, extend expiryDate.
      if (!latest) {
        const row = await tx.membership.create({
          data: {
            userId,
            type: t,
            startDate: now,
            expiryDate: nextExpiry,
            status: MembershipStatus.ACTIVE,
            amountPaidCents: 0,
            paymentProvider: null,
            paymentRef: null,
          },
          select: { type: true, expiryDate: true },
        });
        results.push({ type: row.type, expiryDate: row.expiryDate.toISOString() });
      } else {
        const row = await tx.membership.update({
          where: { id: latest.id },
          data: { expiryDate: nextExpiry, status: MembershipStatus.ACTIVE },
          select: { type: true, expiryDate: true },
        });
        results.push({ type: row.type, expiryDate: row.expiryDate.toISOString() });
      }
    }

    return results;
  });

  return res.status(200).json({ ok: true, userId, updated });
}
