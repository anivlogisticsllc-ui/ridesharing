// pages/api/rider/chat-notifications.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";

type ConversationNotification = {
  conversationId: string;
  latestMessageId: string | null;
  latestMessageCreatedAt: string | null;
  senderType: "RIDER" | "DRIVER" | "UNKNOWN";
};

type ApiResponse =
  | { ok: true; notifications: ConversationNotification[] }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);

  const user = session?.user as
    | ({
        id?: string;
        name?: string | null;
        email?: string | null;
        image?: string | null;
      } & {
        role?: "RIDER" | "DRIVER" | "BOTH";
      })
    | undefined;

  if (!user?.id) {
    return res
      .status(401)
      .json({ ok: false, error: "Not authenticated" });
  }

  const riderId = user.id;

  try {
    const conversations = await prisma.conversation.findMany({
      where: { riderId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        riderId: true,
        driverId: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            createdAt: true,
            senderId: true,
          },
        },
      },
    });

    if (!conversations.length) {
      return res
        .status(200)
        .json({ ok: true, notifications: [] });
    }

    const notifications: ConversationNotification[] =
      conversations.map((c) => {
        const latest = c.messages[0];

        if (!latest) {
          return {
            conversationId: c.id,
            latestMessageId: null,
            latestMessageCreatedAt: null,
            senderType: "UNKNOWN",
          };
        }

        let senderType: "RIDER" | "DRIVER" | "UNKNOWN" = "UNKNOWN";
        if (latest.senderId === c.riderId) senderType = "RIDER";
        else if (latest.senderId === c.driverId) senderType = "DRIVER";

        return {
          conversationId: c.id,
          latestMessageId: latest.id,
          latestMessageCreatedAt: latest.createdAt.toISOString(),
          senderType,
        };
      });

    return res.status(200).json({ ok: true, notifications });
  } catch (err) {
    console.error("Error loading rider chat notifications:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to load notifications",
    });
  }
}
