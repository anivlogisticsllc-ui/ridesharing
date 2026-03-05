// app/api/admin/users/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

/** ---------------- Types / helpers ---------------- */

type SessionRole = "RIDER" | "DRIVER" | "ADMIN";

function isRole(v: unknown): v is SessionRole {
  return v === "RIDER" || v === "DRIVER" || v === "ADMIN";
}

// Must match schema.prisma enum AccountStatus
const ALLOWED_STATUSES = new Set(["ACTIVE", "SUSPENDED", "DISABLED"] as const);
type AccountStatus = (typeof ALLOWED_STATUSES extends Set<infer T> ? T : never) & string;

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(details ? { ok: false, error, details } : { ok: false, error }, { status });
}

function prismaErrorToHttp(e: unknown): { status: number; message: string; details?: any } {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    switch (e.code) {
      case "P2025":
        return { status: 404, message: "Not found." };
      case "P2003":
        return {
          status: 409,
          message: "Update failed due to related records (foreign key constraint).",
          details: { code: e.code, meta: e.meta },
        };
      case "P2022":
        return {
          status: 500,
          message: "Database schema mismatch (missing column).",
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

function parseIsoDateOrNull(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined; // not provided
  if (v === null) return null; // explicit clear
  if (typeof v !== "string") return undefined;

  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function toIsoOrNull(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function serializeUser(u: any) {
  return {
    ...u,
    createdAt: toIsoOrNull(u.createdAt),
    updatedAt: toIsoOrNull(u.updatedAt),
    trialEndsAt: toIsoOrNull(u.trialEndsAt),
    freeMembershipEndsAt: toIsoOrNull(u.freeMembershipEndsAt),
  };
}

/** ---------------- Admin check ---------------- */

async function requireAdmin() {
  const session = await getServerSession(authOptions);

  const userId = (session?.user as any)?.id as string | undefined;
  const role = (session?.user as any)?.role as SessionRole | undefined;
  const isAdminFlag = Boolean((session?.user as any)?.isAdmin);

  if (!userId) return { ok: false as const, status: 401, error: "Not authenticated" };

  // Fast path: ADMIN role or legacy isAdmin flag
  if (role === "ADMIN" || isAdminFlag) return { ok: true as const, userId };

  // Temporary DB grant: freeMembershipEndsAt in the future
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { freeMembershipEndsAt: true },
  });

  if (u?.freeMembershipEndsAt && u.freeMembershipEndsAt > new Date()) {
    return { ok: true as const, userId };
  }

  return { ok: false as const, status: 403, error: "Forbidden" };
}

/** ---------------- Select ---------------- */

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isAdmin: true,
  accountStatus: true,
  createdAt: true,
  updatedAt: true,

  publicId: true,
  onboardingCompleted: true,

  membershipActive: true,
  membershipPlan: true,
  trialEndsAt: true,

  freeMembershipEndsAt: true,

  driverProfile: {
    select: {
      verificationStatus: true,
      plateNumber: true,
      plateState: true,
      vehicleColor: true,
      vehicleMake: true,
      vehicleModel: true,
      vehicleYear: true,
    },
  },
} as const;

/** ---------------- GET ---------------- */

export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return jsonError(guard.status, guard.error);

  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const roleParam = (url.searchParams.get("role") || "").trim();
    const cursor = (url.searchParams.get("cursor") || "").trim();

    const takeRaw = url.searchParams.get("take");
    const takeParsed = takeRaw ? Number(takeRaw) : 100;
    const take = Number.isFinite(takeParsed) ? Math.min(Math.max(Math.trunc(takeParsed), 1), 200) : 100;

    const where: Prisma.UserWhereInput = {};

    if (isRole(roleParam)) {
      where.role = roleParam;
    }

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
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: USER_SELECT,
    });

    const nextCursor = users.length === take ? users[users.length - 1]?.id ?? null : null;

    return NextResponse.json({
      ok: true,
      users: users.map(serializeUser),
      nextCursor,
    });
  } catch (e) {
    const pe = prismaErrorToHttp(e);
    return jsonError(pe.status, pe.message, pe.details);
  }
}

/** ---------------- PATCH ---------------- */

type PatchBody = {
  userId: string;

  role?: SessionRole;
  accountStatus?: string;
  isAdmin?: boolean;

  // extend from current (or now) by N days
  grantDays?: number;

  // set/clear directly
  freeMembershipEndsAt?: string | null;
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

  const data: Record<string, unknown> = {};

  if (body.role !== undefined) {
    if (!isRole(body.role)) return jsonError(400, `Invalid role: ${String(body.role)}`);
    data.role = body.role;
  }

  if (typeof body.accountStatus === "string") {
    const s = body.accountStatus.toUpperCase();
    if (!ALLOWED_STATUSES.has(s as any)) return jsonError(400, `Invalid accountStatus: ${body.accountStatus}`);
    data.accountStatus = s as AccountStatus;
  }

  if (typeof body.isAdmin === "boolean") {
    data.isAdmin = body.isAdmin;
  }

  const hasGrantDays = typeof body.grantDays === "number" && Number.isFinite(body.grantDays);
  const parsedExplicit = parseIsoDateOrNull(body.freeMembershipEndsAt);

  try {
    if (hasGrantDays) {
      const days = Math.trunc(body.grantDays as number);
      if (days < 1 || days > 3650) return jsonError(400, "grantDays must be between 1 and 3650.");

      const existing = await prisma.user.findUnique({
        where: { id: body.userId },
        select: { freeMembershipEndsAt: true },
      });
      if (!existing) return jsonError(404, "User not found.");

      const now = new Date();
      const current = existing.freeMembershipEndsAt ? new Date(existing.freeMembershipEndsAt) : null;
      const base = current && !Number.isNaN(current.getTime()) && current > now ? current : now;

      data.freeMembershipEndsAt = addDays(base, days);
    } else if (parsedExplicit !== undefined) {
      data.freeMembershipEndsAt = parsedExplicit;
    }

    if (Object.keys(data).length === 0) return jsonError(400, "No fields to update");

    const updated = await prisma.user.update({
      where: { id: body.userId },
      data: data as any,
      select: USER_SELECT,
    });

    return NextResponse.json({ ok: true, user: serializeUser(updated) });
  } catch (e) {
    const pe = prismaErrorToHttp(e);
    return jsonError(pe.status, pe.message, pe.details);
  }
}

/** ---------------- DELETE ---------------- */

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
    return jsonError(pe.status, pe.message, pe.details);
  }
}
