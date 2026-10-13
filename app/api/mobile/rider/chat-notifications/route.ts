// app/api/mobile/rider/chat-notifications/route.ts

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const JWT_SECRET = process.env.MOBILE_JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("MOBILE_JWT_SECRET is not configured");
}

const secret = new TextEncoder().encode(JWT_SECRET);

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:8081",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store, max-age=0",
};

type MobileJwtPayload = {
  sub?: string;
};

type SenderType = "RIDER" | "DRIVER" | "UNKNOWN";

async function getMobileUserId(
  req: NextRequest
): Promise<string | null> {
  const authHeader =
    req.headers.get("authorization") || "";

  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader
    .slice("Bearer ".length)
    .trim();

  if (!token) return null;

  try {
    const verified = await jwtVerify(token, secret);
    const payload = verified.payload as MobileJwtPayload;

    return typeof payload.sub === "string" && payload.sub
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET(req: NextRequest) {
  const riderId = await getMobileUserId(req);

  if (!riderId) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated" },
      { status: 401, headers: corsHeaders }
    );
  }

  try {
    const conversations = await prisma.conversation.findMany({
      where: { riderId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        riderId: true,
        driverId: true,
        riderLastReadAt: true,
        ride: {
          select: {
            id: true,
            status: true,
          },
        },
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
      return NextResponse.json(
        {
          ok: true,
          totalUnread: 0,
          notifications: [],
        },
        { headers: corsHeaders }
      );
    }

    const conversationIds =
      conversations.map((conversation) => conversation.id);

    const unreadRows = await prisma.$queryRaw<
      {
        conversationId: string;
        unreadCount: bigint;
      }[]
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
      unreadRows.map((row) => [
        row.conversationId,
        Number(row.unreadCount),
      ])
    );

    const rows = conversations.map((conversation) => {
      const latest = conversation.messages[0] ?? null;
      const unreadCount =
        unreadMap.get(conversation.id) ?? 0;

      let senderType: SenderType = "UNKNOWN";

      if (latest) {
        if (latest.senderId === conversation.riderId) {
          senderType = "RIDER";
        } else if (
          latest.senderId === conversation.driverId
        ) {
          senderType = "DRIVER";
        }
      }

      return {
        conversationId: conversation.id,
        rideId: conversation.ride?.id ?? null,
        rideStatus: conversation.ride?.status ?? null,
        unreadCount,
        latestMessageId: latest?.id ?? null,
        latestMessageCreatedAt:
          latest?.createdAt?.toISOString() ?? null,
        latestMessageSenderId:
          latest?.senderId ?? null,
        senderType,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        totalUnread: rows.reduce(
          (sum, row) => sum + row.unreadCount,
          0
        ),
        notifications: rows.filter(
          (row) => row.unreadCount > 0
        ),
      },
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error(
      "[mobile/rider/chat-notifications] error:",
      err
    );

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load notifications",
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}