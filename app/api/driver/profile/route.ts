import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

/* ---------- Types ---------- */

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

/* ---------- Helpers ---------- */

function parseDate(value: string | undefined): Date | null | undefined {
  if (value == null || value === "") return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

/* ---------- GET: return current user's driver profile + onboarding ---------- */

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        membershipActive: true,
        membershipPlan: true,
        trialEndsAt: true,
        onboardingCompleted: true,
        onboardingStep: true,
        driverProfile: {
          select: {
            id: true,
            baseCity: true,
            baseLat: true,
            baseLng: true,

            legalName: true,
            dateOfBirth: true,

            driverLicenseNumber: true,
            driverLicenseState: true,
            driverLicenseExpiry: true,
            driverLicenseImageUrl: true,

            verificationStatus: true,
            verificationNotes: true,

            vehicleMake: true,
            vehicleModel: true,
            vehicleYear: true,
            vehicleColor: true,
            plateNumber: true,
            plateState: true,

            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "User not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, user });
  } catch (err) {
    console.error("GET /api/driver/profile error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/* ---------- PUT: update onboarding + identity + vehicle ---------- */

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const body = (await req.json()) as ProfileUpdateBody;

    const {
      onboardingCompleted,
      onboardingStep,

      legalName,
      dateOfBirth,

      driverLicenseNumber,
      driverLicenseState,
      driverLicenseExpiry,

      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
      plateNumber,
      plateState,
    } = body;

    // --- Update User (onboarding flags) ---
    const userData: Record<string, unknown> = {};

    if (typeof onboardingCompleted === "boolean") {
      userData.onboardingCompleted = onboardingCompleted;
    }
    if (
      typeof onboardingStep === "number" &&
      Number.isFinite(onboardingStep)
    ) {
      userData.onboardingStep = onboardingStep;
    }

    if (Object.keys(userData).length > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: userData,
      });
    }

    // --- Upsert DriverProfile ---
    const parsedDob = parseDate(dateOfBirth);
    const parsedExpiry = parseDate(driverLicenseExpiry);

    let parsedVehicleYear: number | null | undefined = undefined;
    if (vehicleYear !== undefined) {
      if (vehicleYear === null || vehicleYear === "") {
        parsedVehicleYear = null;
      } else {
        const n = Number(vehicleYear);
        parsedVehicleYear = Number.isNaN(n) ? null : n;
      }
    }

    await prisma.driverProfile.upsert({
      where: { userId },
      create: {
        userId,

        legalName: legalName ?? null,
        dateOfBirth: parsedDob ?? null,

        driverLicenseNumber: driverLicenseNumber ?? null,
        driverLicenseState: driverLicenseState ?? null,
        driverLicenseExpiry: parsedExpiry ?? null,

        vehicleMake: vehicleMake ?? null,
        vehicleModel: vehicleModel ?? null,
        vehicleYear: parsedVehicleYear ?? null,
        vehicleColor: vehicleColor ?? null,
        plateNumber: plateNumber ?? null,
        plateState: plateState ?? null,
      },
      update: {
        legalName: legalName ?? undefined,
        dateOfBirth: parsedDob ?? undefined,

        driverLicenseNumber: driverLicenseNumber ?? undefined,
        driverLicenseState: driverLicenseState ?? undefined,
        driverLicenseExpiry: parsedExpiry ?? undefined,

        vehicleMake: vehicleMake ?? undefined,
        vehicleModel: vehicleModel ?? undefined,
        vehicleYear: parsedVehicleYear,
        vehicleColor: vehicleColor ?? undefined,
        plateNumber: plateNumber ?? undefined,
        plateState: plateState ?? undefined,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/driver/profile error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
