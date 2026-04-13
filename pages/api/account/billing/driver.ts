// OATH: Clean replacement file
// FILE: pages/api/account/billing/driver.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import {
  buildDriverPayoutView,
  type DriverBillingView,
} from "@/lib/payouts/buildDriverPayoutView";

type DriverBillingResponse =
  | ({ ok: true } & DriverBillingView)
  | { ok: false; error: string };

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
    const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
    const role = (session?.user as {
      role?: "DRIVER" | "ADMIN" | "RIDER";
    } | undefined)?.role;

    if (!sessionUserId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (role !== "DRIVER" && role !== "ADMIN") {
      return res.status(403).json({ ok: false, error: "Driver access only" });
    }

    const adminRequestedDriverId =
      role === "ADMIN" && typeof req.headers["x-admin-driver-id"] === "string"
        ? req.headers["x-admin-driver-id"].trim()
        : "";

    const userId =
      role === "ADMIN" && adminRequestedDriverId
        ? adminRequestedDriverId
        : sessionUserId;

    const view = await buildDriverPayoutView(userId);

    return res.status(200).json({
      ok: true,
      ...view,
    });
  } catch (err: unknown) {
    console.error("Driver billing API error:", err);
    return res.status(500).json({
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to load driver billing",
    });
  }
}