// OATH: Clean replacement file
// FILE: pages/api/notifications/read.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";

import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

type Body = {
  id?: string;
  all?: boolean;
  bookingId?: string;
  type?: string;
  disputeId?: string;
};

type ApiResponse =
  | { ok: true; updatedCount: number }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const userId =
      typeof (session?.user as { id?: unknown } | undefined)?.id === "string"
        ? (session?.user as { id: string }).id
        : "";

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const body = (req.body ?? {}) as Body;
    const now = new Date();

    if (body.all === true) {
      const result = await prisma.notification.updateMany({
        where: {
          userId,
          readAt: null,
        },
        data: {
          readAt: now,
        },
      });

      return res.status(200).json({ ok: true, updatedCount: result.count });
    }

    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (id) {
      const result = await prisma.notification.updateMany({
        where: {
          id,
          userId,
          readAt: null,
        },
        data: {
          readAt: now,
        },
      });

      return res.status(200).json({ ok: true, updatedCount: result.count });
    }

    const bookingId =
      typeof body.bookingId === "string" ? body.bookingId.trim() : "";
    const type = typeof body.type === "string" ? body.type.trim() : "";
    const disputeId =
      typeof body.disputeId === "string" ? body.disputeId.trim() : "";

    if (!bookingId && !disputeId) {
      return res.status(400).json({
        ok: false,
        error:
          "Notification id is required, or provide bookingId/disputeId filter.",
      });
    }

    const result = await prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        ...(bookingId ? { bookingId } : {}),
        ...(type ? { type: type as never } : {}),
        ...(disputeId
          ? {
              metadata: {
                path: ["disputeId"],
                equals: disputeId,
              },
            }
          : {}),
      },
      data: {
        readAt: now,
      },
    });

    return res.status(200).json({ ok: true, updatedCount: result.count });
  } catch (err) {
    console.error("[api/notifications/read] error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}
