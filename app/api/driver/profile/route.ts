// app/api/driver/profile/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";

type ProfileUpdateBody = {
  onboardingCompleted?: boolean;
  onboardingStep?: number;

  legalName?: string;
  dateOfBirth?: string; // "YYYY-MM-DD" or ISO

  driverLicenseNumber?: string;
  driverLicenseState?: string;
  driverLicenseExpiry?: string; // "YYYY-MM-DD" or ISO

  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number | string | null;
  vehicleColor?: string;
  plateNumber?: string;
  plateState?: string;
};

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function normalizeYear(value: ProfileUpdateBody["vehicleYear"]): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function isDriverRole(role: UserRole | undefined) {
  return role === "DRIVER" || role === "BOTH";
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id as string | undefined;
    const role = (session?.user?.role as UserRole | undefined) ?? undefined;

    if (!userId) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }
    if (!isDriverRole(role)) {
      return NextResponse.json({ ok: false, error: "Not a driver" }, { status: 403 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        onboardingCompleted: true,
        onboardingStep: true,
      },
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    const dp = await prisma.driverProfile.findUnique({
      where: { userId },
      select: {
        legalName: true,
        dateOfBirth: true,

        driverLicenseNumber: true,
        driverLicenseState: true,
        driverLicenseExpiry: true,
        driverLicenseImageUrl: true,

        vehicleMake: true,
        vehicleModel: true,
        vehicleYear: true,
        vehicleColor: true,
        plateNumber: true,
        plateState: true,

        verificationStatus: true,
        verificationNotes: true,

        baseCity: true,
        baseLat: true,
        baseLng: true,

        createdAt: true,
        updatedAt: true,
      },
    });

    // If you want to auto-create empty profile rows for drivers, do it here.
    if (!dp) {
      return NextResponse.json(
        {
          ok: true,
          user: {
            role: user.role,
            onboardingCompleted: user.onboardingCompleted,
            onboardingStep: user.onboardingStep,
          },
          driverProfile: null,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        user: {
          role: user.role,
          onboardingCompleted: user.onboardingCompleted,
          onboardingStep: user.onboardingStep,
        },
        driverProfile: {
          verificationStatus: String(dp.verificationStatus),
          verificationNotes: dp.verificationNotes ?? null,

          legalName: dp.legalName ?? null,
          dateOfBirth: dp.dateOfBirth ? dp.dateOfBirth.toISOString() : null,

          driverLicenseNumber: dp.driverLicenseNumber ?? null,
          driverLicenseState: dp.driverLicenseState ?? null,
          driverLicenseExpiry: dp.driverLicenseExpiry ? dp.driverLicenseExpiry.toISOString() : null,
          driverLicenseImageUrl: dp.driverLicenseImageUrl ?? null,

          vehicleMake: dp.vehicleMake ?? null,
          vehicleModel: dp.vehicleModel ?? null,
          vehicleYear: dp.vehicleYear ?? null,
          vehicleColor: dp.vehicleColor ?? null,
          plateNumber: dp.plateNumber ?? null,
          plateState: dp.plateState ?? null,

          baseCity: dp.baseCity ?? null,
          baseLat: dp.baseLat ?? null,
          baseLng: dp.baseLng ?? null,

          createdAt: dp.createdAt.toISOString(),
          updatedAt: dp.updatedAt.toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/driver/profile error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id as string | undefined;
    const role = (session?.user?.role as UserRole | undefined) ?? undefined;

    if (!userId) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }
    if (!isDriverRole(role)) {
      return NextResponse.json({ ok: false, error: "Not a driver" }, { status: 403 });
    }

    const body = (await req.json()) as ProfileUpdateBody;

    // Update onboarding flags on User
    const userData: Record<string, unknown> = {};
    if (typeof body.onboardingCompleted === "boolean") userData.onboardingCompleted = body.onboardingCompleted;
    if (typeof body.onboardingStep === "number" && Number.isFinite(body.onboardingStep)) userData.onboardingStep = body.onboardingStep;

    if (Object.keys(userData).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: userData });
    }

    const parsedDob = parseDate(body.dateOfBirth);
    const parsedExpiry = parseDate(body.driverLicenseExpiry);
    const parsedYear = normalizeYear(body.vehicleYear);

    await prisma.driverProfile.upsert({
      where: { userId },
      create: {
        userId,

        legalName: body.legalName ?? null,
        dateOfBirth: parsedDob ?? null,

        driverLicenseNumber: body.driverLicenseNumber ?? null,
        driverLicenseState: body.driverLicenseState ?? null,
        driverLicenseExpiry: parsedExpiry ?? null,

        vehicleMake: body.vehicleMake ?? null,
        vehicleModel: body.vehicleModel ?? null,
        vehicleYear: parsedYear ?? null,
        vehicleColor: body.vehicleColor ?? null,
        plateNumber: body.plateNumber ?? null,
        plateState: body.plateState ?? null,
      },
      update: {
        legalName: body.legalName ?? undefined,
        dateOfBirth: parsedDob ?? undefined,

        driverLicenseNumber: body.driverLicenseNumber ?? undefined,
        driverLicenseState: body.driverLicenseState ?? undefined,
        driverLicenseExpiry: parsedExpiry ?? undefined,

        vehicleMake: body.vehicleMake ?? undefined,
        vehicleModel: body.vehicleModel ?? undefined,
        vehicleYear: parsedYear, // keep as-is when undefined
        vehicleColor: body.vehicleColor ?? undefined,
        plateNumber: body.plateNumber ?? undefined,
        plateState: body.plateState ?? undefined,
      },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("PUT /api/driver/profile error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
