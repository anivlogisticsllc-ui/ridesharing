// app/api/admin/users/[id]/set-password/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcrypt";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

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
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();

  if (!guard.ok) {
    return jsonError(guard.status, guard.error);
  }

  const body = await req.json().catch(() => null);

  const password =
    typeof body?.password === "string"
      ? body.password.trim()
      : "";

  if (!password || password.length < 6) {
    return jsonError(
      400,
      "Password must be at least 6 characters."
    );
  }

  const { id } = await ctx.params;

  const userId = String(id || "").trim();

  if (!userId) {
    return jsonError(400, "Missing user id");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
    },
  });

  if (!user) {
    return jsonError(404, "User not found");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      emailVerified: true,
    },
  });

  return NextResponse.json({
    ok: true,
    message: "Password updated successfully.",
  });
}