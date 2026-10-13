// app/api/mobile/chat/[conversationId]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";

const JWT_SECRET = process.env.MOBILE_JWT_SECRET;
if (!JWT_SECRET) throw new Error("MOBILE_JWT_SECRET is not configured");
const secret = new TextEncoder().encode(JWT_SECRET);

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:8081",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store, max-age=0",
};

type MobileJwtPayload = { sub?: string };

async function getMobileUserId(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;

  try {
    const verified = await jwtVerify(token, secret);
    const payload = verified.payload as MobileJwtPayload;
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ conversationId: string }> }
) {
  const userId = await getMobileUserId(req);
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated" },
      { status: 401, headers: corsHeaders }
    );
  }

  const { conversationId } = await context.params;

  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      riderId: true,
      ride: { select: { status: true } },
    },
  });

  if (!convo || convo.riderId !== userId) {
    return NextResponse.json(
      { ok: false, error: "Conversation not found" },
      { status: 404, headers: corsHeaders }
    );
  }

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    include: {
      sender: {
        select: { id: true, name: true, publicId: true },
      },
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { riderLastReadAt: new Date() },
  });

  return NextResponse.json(
    {
      ok: true,
      rideStatus: convo.ride?.status ?? null,
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        senderId: m.senderId,
        sender: m.sender,
      })),
    },
    { headers: corsHeaders }
  );
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ conversationId: string }> }
) {
  const userId = await getMobileUserId(req);
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated" },
      { status: 401, headers: corsHeaders }
    );
  }

  const { conversationId } = await context.params;

  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      riderId: true,
      ride: { select: { status: true } },
    },
  });

  if (!convo || convo.riderId !== userId) {
    return NextResponse.json(
      { ok: false, error: "Conversation not found" },
      { status: 404, headers: corsHeaders }
    );
  }

  const rideStatus = convo.ride?.status;
  if (rideStatus === "COMPLETED" || rideStatus === "CANCELLED") {
    return NextResponse.json(
      {
        ok: false,
        error: "This chat is read-only because the trip is completed/cancelled.",
      },
      { status: 403, headers: corsHeaders }
    );
  }

  const body = await req.json();
  const messageBody = typeof body?.body === "string" ? body.body.trim() : "";

  if (!messageBody) {
    return NextResponse.json(
      { ok: false, error: "Message body is empty" },
      { status: 400, headers: corsHeaders }
    );
  }

  const message = await prisma.message.create({
    data: {
      body: messageBody,
      conversationId,
      senderId: userId,
    },
    include: {
      sender: {
        select: { id: true, name: true, publicId: true },
      },
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { riderLastReadAt: new Date() },
  });

  return NextResponse.json(
    {
      ok: true,
      message: {
        id: message.id,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
        senderId: message.senderId,
        sender: message.sender,
      },
    },
    { status: 201, headers: corsHeaders }
  );
}