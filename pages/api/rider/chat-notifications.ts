// pages/api/rider/chat-notifications.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";

import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";

type ConversationNotification = {
  conversationId: string;
  unreadCount: number;
  latestMessageId: string | null;
  latestMessageCreatedAt: string | null;
  latestMessageSenderId: string | null;
  senderType: "RIDER" | "DRIVER" | "UNKNOWN";
};

type ApiResponse =
  | { ok: true; totalUnread: number; notifications: ConversationNotification[] }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");

  const session = await getServerSession(req, res, authOptions);
  const user = session?.user as { id?: string; role?: "RIDER" | "DRIVER" } | undefined;

  if (!user?.id) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const riderId = user.id;

  try {
    const conversations = await prisma.conversation.findMany({
      where: { riderId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        createdAt: true,
        riderId: true,
        driverId: true,
        riderLastReadAt: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, createdAt: true, senderId: true },
        },
      },
    });

    if (!conversations.length) {
      return res.status(200).json({ ok: true, totalUnread: 0, notifications: [] });
    }

    const conversationIds = conversations.map((c) => c.id);

    const unreadRows = await prisma.$queryRaw<
      { conversationId: string; unreadCount: bigint }[]
    >(Prisma.sql`
      SELECT
        c."id" AS "conversationId",
        COUNT(m."id")::bigint AS "unreadCount"
      FROM "Conversation" c
      LEFT JOIN "Message" m
        ON m."conversationId" = c."id"
       AND m."createdAt" > COALESCE(c."riderLastReadAt", c."createdAt")
       AND m."senderId" <> ${riderId}
      WHERE c."riderId" = ${riderId}
        AND c."id" IN (${Prisma.join(conversationIds)})
      GROUP BY c."id"
    `);

    const unreadMap = new Map<string, number>(
      unreadRows.map((row) => [row.conversationId, Number(row.unreadCount)])
    );

    const rows: ConversationNotification[] = conversations.map((c) => {
      const latest = c.messages[0] ?? null;
      const unreadCount = unreadMap.get(c.id) ?? 0;

      let senderType: "RIDER" | "DRIVER" | "UNKNOWN" = "UNKNOWN";
      if (latest) {
        if (latest.senderId === c.riderId) senderType = "RIDER";
        else if (latest.senderId === c.driverId) senderType = "DRIVER";
      }

      return {
        conversationId: c.id,
        unreadCount,
        latestMessageId: latest?.id ?? null,
        latestMessageCreatedAt: latest?.createdAt?.toISOString() ?? null,
        latestMessageSenderId: latest?.senderId ?? null,
        senderType,
      };
    });

    const totalUnread = rows.reduce((sum, row) => sum + row.unreadCount, 0);
    const notifications = rows.filter((row) => row.unreadCount > 0);

    return res.status(200).json({
      ok: true,
      totalUnread,
      notifications,
    });
  } catch (err) {
    console.error("Error loading rider chat notifications:", err);
    return res.status(500).json({ ok: false, error: "Failed to load notifications" });
  }
}