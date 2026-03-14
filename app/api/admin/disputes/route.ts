// OATH: Clean replacement file
// FILE: app/api/admin/disputes/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { DisputeStatus, UserRole } from "@prisma/client";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

type SessionUser = {
  id?: string | null;
  role?: UserRole | string | null;
};

function startOfDay(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00.000`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfDay(dateStr: string) {
  const d = new Date(`${dateStr}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseStatusFilter(value: string | null) {
  if (!value) return null;

  if (
    value === DisputeStatus.OPEN ||
    value === DisputeStatus.UNDER_REVIEW ||
    value === DisputeStatus.RESOLVED_RIDER ||
    value === DisputeStatus.RESOLVED_DRIVER ||
    value === DisputeStatus.CLOSED
  ) {
    return value;
  }

  if (value === "RESOLVED") {
    return "RESOLVED";
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as SessionUser | undefined;

    const adminId = typeof user?.id === "string" ? user.id.trim() : "";
    if (!adminId) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    if (user?.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { ok: false, error: "Only admins can access disputes." },
        { status: 403 }
      );
    }

    const searchParams = req.nextUrl.searchParams;

    const disputeId = searchParams.get("disputeId")?.trim() ?? "";
    const rider = searchParams.get("rider")?.trim() ?? "";
    const driver = searchParams.get("driver")?.trim() ?? "";
    const from = searchParams.get("from")?.trim() ?? "";
    const to = searchParams.get("to")?.trim() ?? "";
    const dateFrom = searchParams.get("dateFrom")?.trim() ?? "";
    const dateTo = searchParams.get("dateTo")?.trim() ?? "";
    const statusFilter = parseStatusFilter(searchParams.get("status"));

    const createdAtFilter: {
      gte?: Date;
      lte?: Date;
    } = {};

    const dateFromValue = dateFrom ? startOfDay(dateFrom) : null;
    const dateToValue = dateTo ? endOfDay(dateTo) : null;

    if (dateFrom && !dateFromValue) {
      return NextResponse.json(
        { ok: false, error: "Invalid dateFrom value." },
        { status: 400 }
      );
    }

    if (dateTo && !dateToValue) {
      return NextResponse.json(
        { ok: false, error: "Invalid dateTo value." },
        { status: 400 }
      );
    }

    if (dateFromValue) createdAtFilter.gte = dateFromValue;
    if (dateToValue) createdAtFilter.lte = dateToValue;

    const disputes = await prisma.dispute.findMany({
      where: {
        ...(disputeId
          ? {
              id: {
                contains: disputeId,
                mode: "insensitive",
              },
            }
          : {}),
        ...(statusFilter === "RESOLVED"
          ? {
              status: {
                in: [DisputeStatus.RESOLVED_RIDER, DisputeStatus.RESOLVED_DRIVER],
              },
            }
          : statusFilter
          ? {
              status: statusFilter,
            }
          : {}),
        ...(dateFromValue || dateToValue
          ? {
              createdAt: createdAtFilter,
            }
          : {}),
        booking: {
          ...(rider
            ? {
                OR: [
                  {
                    riderName: {
                      contains: rider,
                      mode: "insensitive",
                    },
                  },
                  {
                    rider: {
                      name: {
                        contains: rider,
                        mode: "insensitive",
                      },
                    },
                  },
                ],
              }
            : {}),
          ride: {
            ...(driver
              ? {
                  driver: {
                    name: {
                      contains: driver,
                      mode: "insensitive",
                    },
                  },
                }
              : {}),
            ...(from
              ? {
                  originCity: {
                    contains: from,
                    mode: "insensitive",
                  },
                }
              : {}),
            ...(to
              ? {
                  destinationCity: {
                    contains: to,
                    mode: "insensitive",
                  },
                }
              : {}),
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        bookingId: true,
        rideId: true,
        status: true,
        createdAt: true,
        booking: {
          select: {
            finalAmountCents: true,
            currency: true,
            fallbackCardChargedAt: true,
            cashNotPaidReason: true,
            riderName: true,
            rider: {
              select: {
                name: true,
              },
            },
            ride: {
              select: {
                originCity: true,
                destinationCity: true,
                driver: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      disputes: disputes.map((item) => ({
        disputeId: item.id,
        bookingId: item.bookingId,
        rideId: item.rideId,
        routeLabel: item.booking?.ride
          ? `${item.booking.ride.originCity} → ${item.booking.ride.destinationCity}`
          : "Unknown route",
        amountCents: item.booking?.finalAmountCents ?? null,
        currency: item.booking?.currency ?? "USD",
        riderName: item.booking?.rider?.name ?? item.booking?.riderName ?? null,
        driverName: item.booking?.ride?.driver?.name ?? null,
        driverReportedReason: item.booking?.cashNotPaidReason ?? null,
        fallbackCardChargedAt: item.booking?.fallbackCardChargedAt
          ? item.booking.fallbackCardChargedAt.toISOString()
          : null,
        riderDisputedAt: item.createdAt.toISOString(),
        disputeStatus: item.status,
      })),
    });
  } catch (error) {
    console.error("[GET /api/admin/disputes] error:", error);

    return NextResponse.json(
      { ok: false, error: "Failed to load disputes." },
      { status: 500 }
    );
  }
}
