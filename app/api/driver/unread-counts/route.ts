// app/api/driver/unread-counts/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";

function isDriverRole(role: UserRole | undefined) {
  return role === "DRIVER";
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    const user = session?.user as { id?: string; role?: UserRole } | undefined;
    const userId = user?.id;
    const role = user?.role;

    if (!userId) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }
    if (!isDriverRole(role)) {
      return NextResponse.json({ ok: false, error: "Not a driver" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const raw = (searchParams.get("conversationIds") ?? "").trim();

    if (!raw) {
      return NextResponse.json(
        { ok: true, unreadByConversationId: {} as Record<string, number> },
        { status: 200 }
      );
    }

    const conversationIds = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (conversationIds.length === 0) {
      return NextResponse.json(
        { ok: true, unreadByConversationId: {} as Record<string, number> },
        { status: 200 }
      );
    }

    // Only conversations that belong to this driver
    const convs = await prisma.conversation.findMany({
      where: { id: { in: conversationIds }, driverId: userId },
      select: { id: true, createdAt: true, driverLastReadAt: true },
    });

    const unreadByConversationId: Record<string, number> = {};

    // Simple sequential counts to avoid hammering the pool in dev
    for (const c of convs) {
      const since = c.driverLastReadAt ?? c.createdAt;

      const unreadCount = await prisma.message.count({
        where: {
          conversationId: c.id,
          createdAt: { gt: since },
          senderId: { not: userId },
        },
      });

      unreadByConversationId[c.id] = unreadCount;
    }

    // For any ids that were requested but not found/owned, return 0
    for (const id of conversationIds) {
      if (unreadByConversationId[id] === undefined) unreadByConversationId[id] = 0;
    }

    return NextResponse.json({ ok: true, unreadByConversationId }, { status: 200 });
  } catch (err) {
    console.error("GET /api/driver/unread-counts error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
