// app/api/admin/users/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

/** --------- Guards / helpers --------- */

type SessionRole = "RIDER" | "DRIVER" | "ADMIN";

function isRole(v: unknown): v is SessionRole {
  return v === "RIDER" || v === "DRIVER" || v === "ADMIN";
}

// IMPORTANT: These must match your Prisma enum AccountStatus exactly.
// If your enum is only ACTIVE/SUSPENDED, remove DISABLED here.
const ALLOWED_STATUSES = new Set(["ACTIVE", "SUSPENDED", "DISABLED"] as const);
type AccountStatus = (typeof ALLOWED_STATUSES extends Set<infer T> ? T : never) & string;

async function requireAdmin() {
  const session = await getServerSession(authOptions);

  const userId = (session?.user as any)?.id as string | undefined;
  const role = (session?.user as any)?.role as SessionRole | undefined;

  if (!userId) return { ok: false as const, status: 401, error: "Not authenticated" };
  if (role !== "ADMIN") return { ok: false as const, status: 403, error: "Forbidden" };

  return { ok: true as const, userId };
}

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    details ? { ok: false, error, details } : { ok: false, error },
    { status }
  );
}

function prismaErrorToHttp(e: unknown): { status: number; message: string; details?: any } {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    // Useful known errors:
    // P2002 = unique constraint
    // P2003 = foreign key constraint
    // P2025 = record not found
    switch (e.code) {
      case "P2025":
        return { status: 404, message: "User not found." };
      case "P2003":
        return {
          status: 409,
          message: "Update failed due to related records (foreign key constraint).",
          details: { code: e.code, meta: e.meta },
        };
      default:
        return {
          status: 400,
          message: "Database request failed.",
          details: { code: e.code, meta: e.meta },
        };
    }
  }

  if (e instanceof Prisma.PrismaClientValidationError) {
    return { status: 400, message: "Invalid input for database operation." };
  }

  if (e instanceof Error) {
    return { status: 500, message: e.message || "Server error" };
  }

  return { status: 500, message: "Server error" };
}

/** --------- GET --------- */

export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return jsonError(guard.status, guard.error);

  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const roleParam = (url.searchParams.get("role") || "").trim();

    const where: any = {};

    // Only allow filtering by known roles
    if (isRole(roleParam)) where.role = roleParam;

    if (q) {
      where.OR = [
        { email: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { publicId: { contains: q, mode: "insensitive" } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isAdmin: true, // legacy flag (optional)
        accountStatus: true,
        createdAt: true,
        updatedAt: true,
        publicId: true,
        onboardingCompleted: true,
        membershipActive: true,
        membershipPlan: true,
        trialEndsAt: true,
      },
    });

    return NextResponse.json({ ok: true, users });
  } catch (e) {
    const pe = prismaErrorToHttp(e);
    return jsonError(pe.status, pe.message, pe.details);
  }
}

/** --------- PATCH --------- */

type PatchBody = {
  userId: string;
  role?: SessionRole;
  accountStatus?: string; // validate strictly below
  isAdmin?: boolean; // legacy flag
};

export async function PATCH(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return jsonError(guard.status, guard.error);

  let body: PatchBody | null = null;

  try {
    body = (await req.json().catch(() => null)) as PatchBody | null;
  } catch {
    body = null;
  }

  if (!body?.userId) return jsonError(400, "Missing userId");

  // Prevent admin from removing their own ADMIN role
  if (body.userId === guard.userId && body.role && body.role !== "ADMIN") {
    return jsonError(400, "You cannot remove your own admin role.");
  }

  const data: any = {};

  if (body.role) {
    if (!isRole(body.role)) return jsonError(400, `Invalid role: ${String(body.role)}`);
    data.role = body.role;
  }

  if (typeof body.accountStatus === "string") {
    const s = body.accountStatus.toUpperCase();
    if (!ALLOWED_STATUSES.has(s as any)) {
      return jsonError(400, `Invalid accountStatus: ${body.accountStatus}`);
    }
    data.accountStatus = s as AccountStatus;
  }

  if (typeof body.isAdmin === "boolean") {
    data.isAdmin = body.isAdmin; // legacy flag only
  }

  if (Object.keys(data).length === 0) return jsonError(400, "No fields to update");

  try {
    const updated = await prisma.user.update({
      where: { id: body.userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isAdmin: true,
        accountStatus: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, user: updated });
  } catch (e) {
    const pe = prismaErrorToHttp(e);

    // Extra helpful message for the common “enum mismatch” scenario
    if (
      pe.status === 400 &&
      typeof (e as any)?.message === "string" &&
      String((e as any).message).toLowerCase().includes("invalid input value for enum")
    ) {
      return jsonError(
        400,
        "Invalid accountStatus value for your database enum. Update the enum/migration or remove that option from the UI.",
        { hint: "Check schema.prisma enum AccountStatus and your DB enum values." }
      );
    }

    return jsonError(pe.status, pe.message, pe.details);
  }
}

/** --------- DELETE (optional hard delete) ---------
 * Devil’s advocate: hard delete will often fail due to foreign keys.
 * Prefer soft-delete later (deletedAt).
 *
 * Usage: DELETE /api/admin/users?userId=<id>
 */
export async function DELETE(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return jsonError(guard.status, guard.error);

  const url = new URL(req.url);
  const userId = (url.searchParams.get("userId") || "").trim();
  if (!userId) return jsonError(400, "Missing userId");

  if (userId === guard.userId) return jsonError(400, "You cannot delete yourself.");

  try {
    await prisma.user.delete({ where: { id: userId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const pe = prismaErrorToHttp(e);

    // If FK constraint blocks delete, return 409 with a clear message
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return jsonError(
        409,
        "Cannot delete user because related records exist. Disable/soft-delete is safer.",
        { code: e.code, meta: e.meta }
      );
    }

    return jsonError(pe.status, pe.message, pe.details);
  }
}
