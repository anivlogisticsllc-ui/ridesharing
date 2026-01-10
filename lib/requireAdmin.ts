// lib/requireAdmin.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

export async function requireAdmin(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return { ok: false as const, status: 401, error: "Not authenticated" };

  const role = (session.user as any)?.role as string | undefined;
  const isAdmin = Boolean((session.user as any)?.isAdmin);

  // allow either explicit admin flag or ADMIN role
  if (!isAdmin && role !== "ADMIN") {
    return { ok: false as const, status: 403, error: "Admin only" };
  }

  return { ok: true as const, session };
}
