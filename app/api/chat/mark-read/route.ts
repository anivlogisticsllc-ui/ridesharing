// app/api/chat/mark-read/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

type Body = { conversationId?: string };

type ApiResponse =
  | { ok: true }
  | { ok: false; error: string };

type SessionUser = { id?: string } & Record<string, unknown>;

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const user = (session?.user ?? null) as SessionUser | null;
    const userId = user?.id;

    if (!userId) {
      return NextResponse.json({ ok: false, error: "Not authenticated" } satisfies ApiResponse, {
        status: 401,
      });
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    const conversationId = (body?.conversationId ?? "").trim();

    if (!conversationId) {
      return NextResponse.json({ ok: false, error: "Missing conversationId" } satisfies ApiResponse, {
        status: 400,
      });
    }

    const convo = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, driverId: true, riderId: true },
    });

    if (!convo) {
      return NextResponse.json({ ok: false, error: "Conversation not found" } satisfies ApiResponse, {
        status: 404,
      });
    }

    const now = new Date();

    if (convo.driverId === userId) {
      await prisma.conversation.update({
        where: { id: convo.id },
        data: { driverLastReadAt: now },
      });
      return NextResponse.json({ ok: true } satisfies ApiResponse);
    }

    if (convo.riderId === userId) {
      await prisma.conversation.update({
        where: { id: convo.id },
        data: { riderLastReadAt: now },
      });
      return NextResponse.json({ ok: true } satisfies ApiResponse);
    }

    return NextResponse.json({ ok: false, error: "Forbidden" } satisfies ApiResponse, {
      status: 403,
    });
  } catch (e) {
    console.error("POST /api/chat/mark-read error:", e);
    return NextResponse.json({ ok: false, error: "Internal server error" } satisfies ApiResponse, {
      status: 500,
    });
  }
}
