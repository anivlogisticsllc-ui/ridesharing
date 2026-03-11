import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

type ApiNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
  rideId: string | null;
  bookingId: string | null;
  metadata: unknown;
};

type ApiResponse =
  | {
      ok: true;
      unreadCount: number;
      notifications: ApiNotification[];
    }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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

    const takeRaw = Number(req.query.take ?? 10);
    const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 50) : 10;

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take,
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          readAt: true,
          createdAt: true,
          rideId: true,
          bookingId: true,
          metadata: true,
        },
      }),
      prisma.notification.count({
        where: { userId, readAt: null },
      }),
    ]);

    return res.status(200).json({
      ok: true,
      unreadCount,
      notifications: notifications.map((n) => ({
        id: n.id,
        type: String(n.type),
        title: n.title,
        message: n.message,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
        rideId: n.rideId ?? null,
        bookingId: n.bookingId ?? null,
        metadata: n.metadata ?? null,
      })),
    });
  } catch (err) {
    console.error("[api/notifications] error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}