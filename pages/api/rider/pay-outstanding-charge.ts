// pages/api/rider/pay-outstanding-charge.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { UserRole } from "@prisma/client";

type ApiResponse =
  | { ok: true; stripeStatus: string }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const user = session?.user as { id?: unknown; role?: unknown } | undefined;

    if (typeof user?.id !== "string" || !user.id) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (user.role !== UserRole.RIDER) {
      return res.status(403).json({ ok: false, error: "Only riders." });
    }

    return res.status(410).json({
      ok: false,
      error:
        "Outstanding charge payments are no longer supported. Cash fallback charges are now handled directly on the booking and receipt flow.",
    });
  } catch (err) {
    console.error("[rider/pay-outstanding-charge] error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}