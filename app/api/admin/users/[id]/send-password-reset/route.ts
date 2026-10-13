// app/api/admin/users/[id]/send-password-reset/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import crypto from "crypto";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXTAUTH_URL || "http://localhost:3000";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);

  const userId = (session?.user as any)?.id as string | undefined;
  const role = (session?.user as any)?.role as string | undefined;
  const isAdminFlag = Boolean((session?.user as any)?.isAdmin);

  if (!userId) {
    return { ok: false as const, status: 401, error: "Not authenticated" };
  }

  if (role === "ADMIN" || isAdminFlag) {
    return { ok: true as const };
  }

  return { ok: false as const, status: 403, error: "Forbidden" };
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (!guard.ok) return jsonError(guard.status, guard.error);

  const { id } = await ctx.params;
  const userId = String(id || "").trim();

  if (!userId) return jsonError(400, "Missing user id");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
    },
  });

  if (!user) return jsonError(404, "User not found");
  if (!user.email) return jsonError(400, "User has no email address");

  await prisma.passwordResetToken.deleteMany({
    where: { userId: user.id },
  });

  const token = crypto.randomBytes(40).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30);

  await prisma.passwordResetToken.create({
    data: {
      token,
      userId: user.id,
      expiresAt,
    },
  });

  const resetUrl = `${APP_URL}/auth/reset-password?token=${token}`;
  await sendPasswordResetEmail(user.email, resetUrl);

  return NextResponse.json({
    ok: true,
    sentTo: user.email,
  });
}