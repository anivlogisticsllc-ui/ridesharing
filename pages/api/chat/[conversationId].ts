// pages/api/chat/[conversationId].ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";

type ChatApiResponse =
  | { ok: true; messages?: any[]; message?: any }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ChatApiResponse | { error: string }>
) {
  const session = await getServerSession(req, res, authOptions);

  const user = session?.user as
    | ({
        id?: string;
        name?: string | null;
        email?: string | null;
        image?: string | null;
      } & { role?: string })
    | undefined;

  if (!user?.id) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const userId = user.id;
  const { conversationId } = req.query;

  if (!conversationId || typeof conversationId !== "string") {
    return res.status(400).json({ ok: false, error: "Invalid conversation id" });
  }

  // Ensure this user belongs to the conversation (+ pull ride status for POST blocking)
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      driverId: true,
      riderId: true,
      ride: { select: { status: true } },
    },
  });

  if (!convo || (convo.driverId !== userId && convo.riderId !== userId)) {
    return res.status(404).json({ ok: false, error: "Conversation not found" });
  }

  if (req.method === "GET") {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            publicId: true,
          },
        },
      },
    });

    return res.status(200).json({ ok: true, messages });
  }

  if (req.method === "POST") {
    // Server-side read-only enforcement
    const rideStatus = convo.ride?.status;
    if (rideStatus === "COMPLETED" || rideStatus === "CANCELLED") {
      return res.status(403).json({
        ok: false,
        error: "This chat is read-only because the trip is completed/cancelled.",
      });
    }

    const { body } = req.body as { body?: string };

    if (!body || !body.trim()) {
      return res.status(400).json({ ok: false, error: "Message body is empty" });
    }

    const message = await prisma.message.create({
      data: {
        body: body.trim(),
        conversationId,
        senderId: userId,
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            publicId: true,
          },
        },
      },
    });

    return res.status(201).json({ ok: true, message });
  }

  return res.status(405).end();
}
