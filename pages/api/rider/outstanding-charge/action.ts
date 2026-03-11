// pages/api/rider/outstanding-charge/action.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { UserRole } from "@prisma/client";

type ApiResponse = { ok: false; error: string };

function isRider(role: unknown): boolean {
  return role === UserRole.RIDER || role === "RIDER";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const user = session?.user as { id?: unknown; role?: unknown } | undefined;

    const userId = typeof user?.id === "string" ? user.id : "";
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (!isRider(user?.role)) {
      return res.status(403).json({ ok: false, error: "Only riders can take this action." });
    }

    return res.status(410).json({
      ok: false,
      error:
        "Outstanding charge actions are no longer supported. Cash fallback charges are now handled directly on the booking and receipt flow, with disputes handled separately.",
    });
  } catch (err) {
    console.error("[rider/outstanding-charge/action] error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}