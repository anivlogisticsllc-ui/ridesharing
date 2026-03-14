// OATH: Clean replacement file
// FILE: app/api/admin/disputes/[disputeId]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import {
  AdminActionType,
  AdminTargetType,
  DisputeDecision,
  DisputeStatus,
  NotificationType,
  UserRole,
} from "@prisma/client";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

type SessionUser = {
  id?: string | null;
  role?: UserRole | string | null;
};

type RouteContext = {
  params: Promise<{
    disputeId: string;
  }>;
};

type PatchBody = {
  status?: string;
  adminNotes?: string;
  refundAmountCents?: number | string | null;
  markRefundIssued?: boolean;
};

function asNonNegativeCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }

  return null;
}

function mapDecision(status: DisputeStatus): DisputeDecision | null {
  if (status === DisputeStatus.RESOLVED_RIDER) {
    return DisputeDecision.RIDER_FAVORED;
  }
  if (status === DisputeStatus.RESOLVED_DRIVER) {
    return DisputeDecision.DRIVER_FAVORED;
  }
  if (status === DisputeStatus.CLOSED) {
    return DisputeDecision.NO_ACTION;
  }
  return null;
}

function mapAuditAction(status: DisputeStatus): AdminActionType | null {
  if (status === DisputeStatus.UNDER_REVIEW) {
    return AdminActionType.DISPUTE_MARKED_UNDER_REVIEW;
  }
  if (status === DisputeStatus.RESOLVED_RIDER) {
    return AdminActionType.DISPUTE_RESOLVED_RIDER;
  }
  if (status === DisputeStatus.RESOLVED_DRIVER) {
    return AdminActionType.DISPUTE_RESOLVED_DRIVER;
  }
  return null;
}

function mapNotificationType(status: DisputeStatus): NotificationType {
  if (status === DisputeStatus.RESOLVED_RIDER) {
    return NotificationType.DISPUTE_RESOLVED_RIDER;
  }
  if (status === DisputeStatus.RESOLVED_DRIVER) {
    return NotificationType.DISPUTE_RESOLVED_DRIVER;
  }
  return NotificationType.DISPUTE_STATUS_UPDATED;
}

function statusMessage(status: DisputeStatus) {
  if (status === DisputeStatus.UNDER_REVIEW) {
    return {
      title: "Dispute under review",
      message: "An admin marked this dispute as under review.",
    };
  }

  if (status === DisputeStatus.RESOLVED_RIDER) {
    return {
      title: "Dispute resolved",
      message: "This dispute was resolved in the rider's favor.",
    };
  }

  if (status === DisputeStatus.RESOLVED_DRIVER) {
    return {
      title: "Dispute resolved",
      message: "This dispute was resolved in the driver's favor.",
    };
  }

  if (status === DisputeStatus.CLOSED) {
    return {
      title: "Dispute closed",
      message: "This dispute was closed by an admin.",
    };
  }

  return {
    title: "Dispute updated",
    message: "This dispute status was updated by an admin.",
  };
}

function isAllowedStatus(value: unknown): value is DisputeStatus {
  return (
    value === DisputeStatus.OPEN ||
    value === DisputeStatus.UNDER_REVIEW ||
    value === DisputeStatus.RESOLVED_RIDER ||
    value === DisputeStatus.RESOLVED_DRIVER ||
    value === DisputeStatus.CLOSED
  );
}

export async function GET(_req: NextRequest, context: RouteContext) {
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
        { ok: false, error: "Only admins can access dispute details." },
        { status: 403 }
      );
    }

    const { disputeId } = await context.params;
    const cleanDisputeId = disputeId?.trim();

    if (!cleanDisputeId) {
      return NextResponse.json(
        { ok: false, error: "Missing disputeId" },
        { status: 400 }
      );
    }

    const dispute = await prisma.dispute.findUnique({
      where: {
        id: cleanDisputeId,
      },
      include: {
        booking: {
          include: {
            rider: {
              select: {
                name: true,
                email: true,
              },
            },
            ride: {
              include: {
                driver: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
                rider: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        adminAuditLogs: {
          orderBy: {
            createdAt: "desc",
          },
          include: {
            adminUser: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!dispute || !dispute.booking || !dispute.booking.ride) {
      return NextResponse.json(
        { ok: false, error: "Dispute not found." },
        { status: 404 }
      );
    }

    const riderName =
      dispute.booking.rider?.name ??
      dispute.booking.riderName ??
      dispute.booking.ride.rider?.name ??
      null;

    const riderEmail =
      dispute.booking.rider?.email ??
      dispute.booking.riderEmail ??
      dispute.booking.ride.rider?.email ??
      null;

    const driverName = dispute.booking.ride.driver?.name ?? null;
    const driverEmail = dispute.booking.ride.driver?.email ?? null;

    return NextResponse.json({
      ok: true,
      dispute: {
        id: dispute.id,
        bookingId: dispute.bookingId,
        rideId: dispute.rideId,
        status: dispute.status,
        reason: dispute.reason,
        riderStatement: dispute.riderStatement,
        adminDecision: dispute.adminDecision ?? null,
        adminNotes: dispute.adminNotes ?? null,
        resolvedAt: dispute.resolvedAt ? dispute.resolvedAt.toISOString() : null,
        createdAt: dispute.createdAt.toISOString(),
        refundIssued: dispute.refundIssued,
        refundAmountCents: dispute.refundAmountCents ?? null,
        refundIssuedAt: dispute.refundIssuedAt
          ? dispute.refundIssuedAt.toISOString()
          : null,
      },
      booking: {
        id: dispute.booking.id,
        paymentType: dispute.booking.paymentType ?? null,
        cashNotPaidAt: dispute.booking.cashNotPaidAt
          ? dispute.booking.cashNotPaidAt.toISOString()
          : null,
        fallbackCardChargedAt: dispute.booking.fallbackCardChargedAt
          ? dispute.booking.fallbackCardChargedAt.toISOString()
          : null,
        cashNotPaidReason: dispute.booking.cashNotPaidReason ?? null,
        cashNotPaidNote: dispute.booking.cashNotPaidNote ?? null,
        baseAmountCents: dispute.booking.baseAmountCents ?? null,
        finalAmountCents: dispute.booking.finalAmountCents ?? null,
        currency: dispute.booking.currency ?? "USD",
      },
      ride: {
        id: dispute.booking.ride.id,
        originCity: dispute.booking.ride.originCity ?? "",
        destinationCity: dispute.booking.ride.destinationCity ?? "",
        departureTime: dispute.booking.ride.departureTime
          ? dispute.booking.ride.departureTime.toISOString()
          : "",
        tripCompletedAt: dispute.booking.ride.tripCompletedAt
          ? dispute.booking.ride.tripCompletedAt.toISOString()
          : null,
        status: dispute.booking.ride.status,
        riderName,
        riderEmail,
        driverName,
        driverEmail,
      },
      auditLogs: dispute.adminAuditLogs.map((log) => ({
        id: log.id,
        actionType: log.actionType,
        targetType: log.targetType,
        targetId: log.targetId,
        notes: log.notes ?? null,
        createdAt: log.createdAt.toISOString(),
        adminUserName: log.adminUser?.name ?? null,
      })),
    });
  } catch (error) {
    console.error("[GET /api/admin/disputes/[disputeId]] error:", error);

    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
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
        { ok: false, error: "Only admins can update disputes." },
        { status: 403 }
      );
    }

    const { disputeId } = await context.params;
    const cleanDisputeId = disputeId?.trim();

    if (!cleanDisputeId) {
      return NextResponse.json(
        { ok: false, error: "Missing disputeId" },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as PatchBody;

    if (!isAllowedStatus(body.status)) {
      return NextResponse.json(
        { ok: false, error: "Valid dispute status is required." },
        { status: 400 }
      );
    }

    const adminNotes =
      typeof body.adminNotes === "string"
        ? body.adminNotes.trim().slice(0, 4000)
        : "";

    const existing = await prisma.dispute.findUnique({
      where: {
        id: cleanDisputeId,
      },
      select: {
        id: true,
        bookingId: true,
        rideId: true,
        riderId: true,
        driverId: true,
        refundIssued: true,
        refundAmountCents: true,
        refundIssuedAt: true,
        booking: {
          select: {
            finalAmountCents: true,
            currency: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Dispute not found." },
        { status: 404 }
      );
    }

    const nextStatus = body.status as DisputeStatus;
    const nextDecision = mapDecision(nextStatus);
    const nextResolvedAt =
      nextStatus === DisputeStatus.RESOLVED_RIDER ||
      nextStatus === DisputeStatus.RESOLVED_DRIVER ||
      nextStatus === DisputeStatus.CLOSED
        ? new Date()
        : null;

    const requestedRefundAmount = asNonNegativeCents(body.refundAmountCents);
    const bookingFinalAmount =
      asNonNegativeCents(existing.booking?.finalAmountCents) ?? 0;

    const shouldMarkRefundIssued =
      nextStatus === DisputeStatus.RESOLVED_RIDER && body.markRefundIssued === true;

    let nextRefundIssued = false;
    let nextRefundAmountCents: number | null = null;
    let nextRefundIssuedAt: Date | null = null;

    if (shouldMarkRefundIssued) {
      nextRefundIssued = true;
      nextRefundAmountCents =
        requestedRefundAmount !== null ? requestedRefundAmount : bookingFinalAmount;
      nextRefundIssuedAt = new Date();
    }

    const updated = await prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.update({
        where: {
          id: cleanDisputeId,
        },
        data: {
          status: nextStatus,
          adminNotes: adminNotes || null,
          adminDecision: nextDecision,
          resolvedAt: nextResolvedAt,
          resolvedByAdminId: adminId,
          refundIssued: nextRefundIssued,
          refundAmountCents: nextRefundAmountCents,
          refundIssuedAt: nextRefundIssuedAt,
        },
        select: {
          id: true,
          status: true,
          adminDecision: true,
          adminNotes: true,
          resolvedAt: true,
          bookingId: true,
          rideId: true,
          refundIssued: true,
          refundAmountCents: true,
          refundIssuedAt: true,
        },
      });

      const auditAction = mapAuditAction(nextStatus);
      if (auditAction) {
        await tx.adminAuditLog.create({
          data: {
            adminUserId: adminId,
            disputeId: dispute.id,
            actionType: auditAction,
            targetType: AdminTargetType.DISPUTE,
            targetId: dispute.id,
            notes: adminNotes || null,
            metadata: {
              disputeId: dispute.id,
              bookingId: dispute.bookingId,
              rideId: dispute.rideId,
              status: dispute.status,
            },
          },
        });
      }

      if (shouldMarkRefundIssued && dispute.refundIssued) {
        await tx.adminAuditLog.create({
          data: {
            adminUserId: adminId,
            disputeId: dispute.id,
            actionType: AdminActionType.FALLBACK_CHARGE_REFUNDED,
            targetType: AdminTargetType.DISPUTE,
            targetId: dispute.id,
            notes:
              adminNotes ||
              `Refund bookkeeping recorded for ${dispute.refundAmountCents ?? 0} cents.`,
            metadata: {
              disputeId: dispute.id,
              bookingId: dispute.bookingId,
              rideId: dispute.rideId,
              refundIssued: dispute.refundIssued,
              refundAmountCents: dispute.refundAmountCents ?? 0,
              refundIssuedAt: dispute.refundIssuedAt?.toISOString() ?? null,
            },
          },
        });

        await tx.notification.create({
          data: {
            userId: existing.riderId,
            rideId: existing.rideId,
            bookingId: existing.bookingId,
            type: NotificationType.REFUND_ISSUED,
            title: "Refund recorded",
            message: `A refund of ${(
              (dispute.refundAmountCents ?? 0) / 100
            ).toFixed(2)} ${(existing.booking?.currency ?? "USD").toUpperCase()} was recorded for this dispute.`,
            metadata: {
              disputeId: existing.id,
              bookingId: existing.bookingId,
              rideId: existing.rideId,
              refundAmountCents: dispute.refundAmountCents ?? 0,
            },
          },
        });

        if (existing.driverId) {
          await tx.notification.create({
            data: {
              userId: existing.driverId,
              rideId: existing.rideId,
              bookingId: existing.bookingId,
              type: NotificationType.REFUND_ISSUED,
              title: "Refund recorded",
              message:
                "An admin recorded a refund for this fallback charge dispute.",
              metadata: {
                disputeId: existing.id,
                bookingId: existing.bookingId,
                rideId: existing.rideId,
                refundAmountCents: dispute.refundAmountCents ?? 0,
              },
            },
          });
        }
      }

      const msg = statusMessage(nextStatus);
      const notifType = mapNotificationType(nextStatus);

      await tx.notification.create({
        data: {
          userId: existing.riderId,
          rideId: existing.rideId,
          bookingId: existing.bookingId,
          type: notifType,
          title: msg.title,
          message: msg.message,
          metadata: {
            disputeId: existing.id,
            bookingId: existing.bookingId,
            rideId: existing.rideId,
            status: nextStatus,
          },
        },
      });

      if (existing.driverId) {
        await tx.notification.create({
          data: {
            userId: existing.driverId,
            rideId: existing.rideId,
            bookingId: existing.bookingId,
            type: notifType,
            title: msg.title,
            message: msg.message,
            metadata: {
              disputeId: existing.id,
              bookingId: existing.bookingId,
              rideId: existing.rideId,
              status: nextStatus,
            },
          },
        });
      }

      return dispute;
    });

    return NextResponse.json({
      ok: true,
      dispute: {
        id: updated.id,
        status: updated.status,
        adminDecision: updated.adminDecision ?? null,
        adminNotes: updated.adminNotes ?? null,
        resolvedAt: updated.resolvedAt ? updated.resolvedAt.toISOString() : null,
        refundIssued: updated.refundIssued,
        refundAmountCents: updated.refundAmountCents ?? null,
        refundIssuedAt: updated.refundIssuedAt
          ? updated.refundIssuedAt.toISOString()
          : null,
      },
    });
  } catch (error) {
    console.error("[PATCH /api/admin/disputes/[disputeId]] error:", error);

    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
