// app/api/admin/users/[id]/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import {
  MembershipStatus,
  MembershipType,
  Prisma,
} from "@prisma/client";

export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    details ? { ok: false, error, details } : { ok: false, error },
    { status }
  );
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

  // Temporary DB grant: freeMembershipEndsAt in the future
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { freeMembershipEndsAt: true },
    });

    if (u?.freeMembershipEndsAt && u.freeMembershipEndsAt > new Date()) {
      return { ok: true as const };
    }
  } catch {
    // ignore
  }

  return { ok: false as const, status: 403, error: "Forbidden" };
}

function isMissingColumnError(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2022") {
    return true;
  }
  const msg = String((e as any)?.message || "").toLowerCase();
  return msg.includes("does not exist") && msg.includes("column");
}

function toDateOrNull(v: unknown) {
  if (v === null) return null;
  if (typeof v !== "string" || !v.trim()) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function pickUserUpdate(body: any) {
  const data: any = {};

  if (body.role) data.role = body.role;
  if (typeof body.accountStatus === "string") data.accountStatus = body.accountStatus;
  if (typeof body.isAdmin === "boolean") data.isAdmin = body.isAdmin;

  // Address (optional)
  if (body.addressLine1 !== undefined) data.addressLine1 = body.addressLine1;
  if (body.addressLine2 !== undefined) data.addressLine2 = body.addressLine2;
  if (body.city !== undefined) data.city = body.city;
  if (body.state !== undefined) data.state = body.state;
  if (body.postalCode !== undefined) data.postalCode = body.postalCode;
  if (body.country !== undefined) data.country = body.country;

  // Legacy membership fields still supported for now
  if (typeof body.membershipActive === "boolean") data.membershipActive = body.membershipActive;
  if (body.membershipPlan !== undefined) data.membershipPlan = body.membershipPlan;
  if (body.trialEndsAt !== undefined) {
    const d = toDateOrNull(body.trialEndsAt);
    if (d !== undefined) data.trialEndsAt = d;
  }

  // Direct set/clear grant
  if (body.freeMembershipEndsAt !== undefined) {
    const d = toDateOrNull(body.freeMembershipEndsAt);
    if (d !== undefined) data.freeMembershipEndsAt = d;
  }

  // Grant days helper
  if (body.grantDays !== undefined) {
    const days = Number(body.grantDays);
    if (Number.isFinite(days) && days >= 1 && days <= 3650) {
      const ends = new Date();
      ends.setDate(ends.getDate() + Math.floor(days));
      data.freeMembershipEndsAt = ends;
    }
  }

  return data;
}

function pickDriverProfileUpdate(dp: any) {
  if (!dp || typeof dp !== "object") return null;

  const data: any = {};

  if (dp.verificationStatus !== undefined) data.verificationStatus = dp.verificationStatus;

  if (dp.plateNumber !== undefined) data.plateNumber = dp.plateNumber;
  if (dp.plateState !== undefined) data.plateState = dp.plateState;

  if (dp.vehicleColor !== undefined) data.vehicleColor = dp.vehicleColor;
  if (dp.vehicleMake !== undefined) data.vehicleMake = dp.vehicleMake;
  if (dp.vehicleModel !== undefined) data.vehicleModel = dp.vehicleModel;

  if (dp.vehicleYear !== undefined) {
    const n = Number(dp.vehicleYear);
    data.vehicleYear = Number.isFinite(n) ? Math.trunc(n) : null;
  }

  if (dp.driverLicenseNumber !== undefined) data.driverLicenseNumber = dp.driverLicenseNumber;
  if (dp.driverLicenseState !== undefined) data.driverLicenseState = dp.driverLicenseState;

  if (dp.driverLicenseExpiry !== undefined) {
    const d = toDateOrNull(dp.driverLicenseExpiry);
    if (d !== undefined) data.driverLicenseExpiry = d;
  }

  return Object.keys(data).length ? data : null;
}

const SELECT_WITH_GRANT = {
  id: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  photoUrl: true,
  bio: true,
  ratingAverage: true,
  ratingCount: true,
  accountStatus: true,
  createdAt: true,
  updatedAt: true,
  emailVerified: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  onboardingCompleted: true,
  onboardingStep: true,
  publicId: true,
  membershipActive: true,
  membershipPlan: true,
  trialEndsAt: true,
  isAdmin: true,
  freeMembershipEndsAt: true,
  driverProfile: {
    select: {
      id: true,
      verificationStatus: true,
      plateNumber: true,
      plateState: true,
      vehicleColor: true,
      vehicleMake: true,
      vehicleModel: true,
      vehicleYear: true,
      driverLicenseNumber: true,
      driverLicenseState: true,
      driverLicenseExpiry: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  memberships: {
    select: {
      id: true,
      type: true,
      plan: true,
      status: true,
      amountPaidCents: true,
      startDate: true,
      expiryDate: true,
      paymentProvider: true,
      paymentRef: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { startDate: "desc" as const },
    take: 10,
  },
} as const;

const SELECT_NO_GRANT: any = { ...SELECT_WITH_GRANT };
delete SELECT_NO_GRANT.freeMembershipEndsAt;

function roleToMembershipType(role: string | null | undefined): MembershipType | null {
  if (role === "RIDER") return MembershipType.RIDER;
  if (role === "DRIVER") return MembershipType.DRIVER;
  return null;
}

function hydrateUserForAdmin(rawUser: any) {
  const now = new Date();
  const expectedType = roleToMembershipType(rawUser?.role);

  const relevantMemberships = Array.isArray(rawUser?.memberships)
    ? rawUser.memberships.filter((m: any) => !expectedType || m.type === expectedType)
    : [];

  const latestMembership = relevantMemberships[0] ?? null;

  const latestActive =
    latestMembership &&
    latestMembership.status === MembershipStatus.ACTIVE &&
    latestMembership.expiryDate &&
    new Date(latestMembership.expiryDate).getTime() > now.getTime();

  const latestIsTrial =
    Boolean(latestActive) &&
    Number(latestMembership?.amountPaidCents ?? 0) === 0;

  const computedMembership = latestMembership
    ? {
        source: "membership_table",
        membershipId: latestMembership.id,
        type: latestMembership.type,
        plan: latestMembership.plan ?? null,
        status: latestIsTrial
          ? "TRIAL"
          : latestActive
          ? "ACTIVE"
          : "EXPIRED",
        active: Boolean(latestActive),
        trialEndsAt: latestIsTrial
          ? new Date(latestMembership.expiryDate).toISOString()
          : null,
        currentPeriodEnd: latestMembership.expiryDate
          ? new Date(latestMembership.expiryDate).toISOString()
          : null,
        amountPaidCents: latestMembership.amountPaidCents ?? 0,
        paymentProvider: latestMembership.paymentProvider ?? null,
        paymentRef: latestMembership.paymentRef ?? null,
      }
    : {
        source: "legacy_user_fields",
        membershipId: null,
        type: expectedType,
        plan: rawUser.membershipPlan ?? null,
        status:
          rawUser.trialEndsAt && new Date(rawUser.trialEndsAt).getTime() > now.getTime()
            ? "TRIAL"
            : rawUser.membershipActive
            ? "ACTIVE"
            : "INACTIVE",
        active: Boolean(rawUser.membershipActive),
        trialEndsAt: rawUser.trialEndsAt
          ? new Date(rawUser.trialEndsAt).toISOString()
          : null,
        currentPeriodEnd: null,
        amountPaidCents: null,
        paymentProvider: null,
        paymentRef: null,
      };

  return {
    ...rawUser,
    // hydrate legacy fields from latest membership row when present
    membershipActive: computedMembership.active,
    membershipPlan: computedMembership.plan ?? rawUser.membershipPlan ?? null,
    trialEndsAt: computedMembership.trialEndsAt,
    computedMembership,
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return jsonError(guard.status, guard.error);

  const { id } = await ctx.params;
  const userId = String(id || "").trim();
  if (!userId) return jsonError(400, "Missing user id");

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: SELECT_WITH_GRANT as any,
    });

    if (!user) return jsonError(404, "User not found");

    return NextResponse.json({
      ok: true,
      user: hydrateUserForAdmin(user),
    });
  } catch (e) {
    if (isMissingColumnError(e)) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: SELECT_NO_GRANT,
      });

      if (!user) return jsonError(404, "User not found");

      return NextResponse.json({
        ok: true,
        user: hydrateUserForAdmin(user),
      });
    }

    console.error("[admin users details]", e);
    return jsonError(500, "Failed to load user details", {
      message: String((e as any)?.message || e),
      code: (e as any)?.code,
    });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return jsonError(guard.status, guard.error);

  const { id } = await ctx.params;
  const userId = String(id || "").trim();
  if (!userId) return jsonError(400, "Missing user id");

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const userData = pickUserUpdate(body);
  const driverProfileData = pickDriverProfileUpdate(body?.driverProfile);

  if (!Object.keys(userData).length && !driverProfileData) {
    return jsonError(400, "No supported fields to update");
  }

  const updateData: any = {
    ...(Object.keys(userData).length ? userData : {}),
    ...(driverProfileData
      ? {
          driverProfile: {
            upsert: {
              create: driverProfileData,
              update: driverProfileData,
            },
          },
        }
      : {}),
  };

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: SELECT_WITH_GRANT as any,
    });

    return NextResponse.json({
      ok: true,
      user: hydrateUserForAdmin(updated),
    });
  } catch (e) {
    if (isMissingColumnError(e)) {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: SELECT_NO_GRANT,
      });

      return NextResponse.json({
        ok: true,
        user: hydrateUserForAdmin(updated),
      });
    }

    console.error("[admin users patch user]", e);
    return jsonError(500, "Failed to update user", {
      message: String((e as any)?.message || e),
      code: (e as any)?.code,
    });
  }
}