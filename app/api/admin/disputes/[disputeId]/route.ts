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
  RefundStatus,
  RidePaymentStatus,
  UserRole,
} from "@prisma/client";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

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
  markRefundIssued?: boolean | null;
};

type StripeRefundResult = {
  id: string;
  status: string | null;
  amount: number;
  ridePaymentId: string;
  ridePaymentFinalAmountCents: number;
  processorFeeLostCents: number | null;
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

function normalizeRefundStatus(status: string | null | undefined): RefundStatus {
  const s = String(status || "").toLowerCase();

  if (s === "succeeded") return RefundStatus.SUCCEEDED;
  if (s === "failed" || s === "canceled") return RefundStatus.FAILED;

  return RefundStatus.PENDING;
}

function buildRefundIdempotencyKey(args: {
  disputeId: string;
  ridePaymentId: string;
  amountCents: number;
}) {
  return `dispute_refund:${args.disputeId}:${args.ridePaymentId}:${args.amountCents}`;
}

function buildPendingProviderRef(idempotencyKey: string) {
  return `pending:${idempotencyKey}`;
}

async function resolveProcessorFeeLostCentsFromChargeRefund(args: {
  refund: {
    id?: string | null;
    amount?: number | null;
    charge?: string | { id?: string | null } | null;
  };
}): Promise<number | null> {
  const refundAmountCents = asNonNegativeCents(args.refund.amount) ?? 0;
  if (refundAmountCents <= 0) return null;

  const chargeId =
    typeof args.refund.charge === "string"
      ? args.refund.charge
      : args.refund.charge?.id ?? null;

  if (!chargeId) return null;

  const charge = await stripe.charges.retrieve(chargeId, {
    expand: ["balance_transaction"],
  });

  const chargeAmountCents = asNonNegativeCents(charge.amount) ?? 0;
  if (chargeAmountCents <= 0) return null;

  const balanceTransaction = charge.balance_transaction;
  if (!balanceTransaction || typeof balanceTransaction === "string") {
    return null;
  }

  const originalChargeFeeCents = asNonNegativeCents(balanceTransaction.fee) ?? 0;

  if (originalChargeFeeCents <= 0) {
    return 0;
  }

  return Math.max(
    0,
    Math.round((originalChargeFeeCents * refundAmountCents) / chargeAmountCents)
  );
}

async function findRefundableRidePayment(args: {
  ridePaymentId?: string | null;
  rideId: string;
  riderId: string;
}) {
  if (args.ridePaymentId) {
    const direct = await prisma.ridePayment.findUnique({
      where: { id: args.ridePaymentId },
      include: {
        refunds: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (direct) return direct;
  }

  return prisma.ridePayment.findFirst({
    where: {
      rideId: args.rideId,
      riderId: args.riderId,
      paymentType: "CARD",
      provider: "STRIPE",
      status: {
        in: [RidePaymentStatus.SUCCEEDED, RidePaymentStatus.REFUNDED],
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      refunds: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
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
        ridePaymentId: true,
        riderId: true,
        driverId: true,
        status: true,
        resolvedAt: true,
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

    const shouldSetResolvedAt =
      nextStatus === DisputeStatus.RESOLVED_RIDER ||
      nextStatus === DisputeStatus.RESOLVED_DRIVER ||
      nextStatus === DisputeStatus.CLOSED;

    const nextResolvedAt = shouldSetResolvedAt
      ? existing.resolvedAt ?? new Date()
      : null;

    const requestedRefundAmount = asNonNegativeCents(body.refundAmountCents);
    const bookingFinalAmount =
      asNonNegativeCents(existing.booking?.finalAmountCents) ?? null;

    const wantsRefund =
      nextStatus === DisputeStatus.RESOLVED_RIDER &&
      (typeof body.markRefundIssued === "boolean"
        ? body.markRefundIssued
        : true);

    let nextRefundIssued = existing.refundIssued;
    let nextRefundAmountCents = existing.refundAmountCents;
    let nextRefundIssuedAt = existing.refundIssuedAt;

    let stripeRefundResult: StripeRefundResult | null = null;

    if (wantsRefund && existing.refundIssued) {
      const requested =
        requestedRefundAmount ??
        existing.refundAmountCents ??
        bookingFinalAmount;

      if (
        typeof requested === "number" &&
        typeof existing.refundAmountCents === "number" &&
        requested !== existing.refundAmountCents
      ) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Refund was already issued for this dispute. Changing the amount here is not allowed.",
          },
          { status: 400 }
        );
      }
    }

    if (wantsRefund && !existing.refundIssued) {
      const resolvedRefundAmountRaw =
        requestedRefundAmount !== null
          ? requestedRefundAmount
          : existing.refundAmountCents ?? bookingFinalAmount;

      if (
        typeof resolvedRefundAmountRaw !== "number" ||
        !Number.isFinite(resolvedRefundAmountRaw) ||
        resolvedRefundAmountRaw <= 0
      ) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Unable to determine refund amount for rider-favored resolution.",
          },
          { status: 400 }
        );
      }

      const resolvedRefundAmount = Math.max(
        0,
        Math.round(resolvedRefundAmountRaw)
      );

      const refundablePayment = await findRefundableRidePayment({
        ridePaymentId: existing.ridePaymentId ?? null,
        rideId: existing.rideId,
        riderId: existing.riderId,
      });

      if (!refundablePayment) {
        return NextResponse.json(
          { ok: false, error: "No refundable ride payment found." },
          { status: 400 }
        );
      }

      const existingSucceededRefundSameAmount = refundablePayment.refunds.find(
        (r) => {
          const cents = asNonNegativeCents(r.amountCents) ?? 0;
          return (
            r.status === RefundStatus.SUCCEEDED &&
            cents === resolvedRefundAmount
          );
        }
      );

      if (existingSucceededRefundSameAmount) {
        if (!existingSucceededRefundSameAmount.providerRef) {
          return NextResponse.json(
            {
              ok: false,
              error: "Refund row is missing Stripe provider reference.",
            },
            { status: 500 }
          );
        }

        stripeRefundResult = {
          id: existingSucceededRefundSameAmount.providerRef,
          status: "succeeded",
          amount: resolvedRefundAmount,
          ridePaymentId: refundablePayment.id,
          ridePaymentFinalAmountCents:
            asNonNegativeCents(refundablePayment.finalAmountCents) ??
            asNonNegativeCents(refundablePayment.amountCents) ??
            resolvedRefundAmount,
          processorFeeLostCents:
            typeof existingSucceededRefundSameAmount.processorFeeLostCents ===
            "number"
              ? Math.max(
                  0,
                  Math.round(
                    existingSucceededRefundSameAmount.processorFeeLostCents
                  )
                )
              : null,
        };

        nextRefundIssued = true;
        nextRefundAmountCents = resolvedRefundAmount;
        nextRefundIssuedAt = existing.refundIssuedAt ?? new Date();
      } else {
        const existingSucceededRefund = refundablePayment.refunds.find((r) => {
          const cents = asNonNegativeCents(r.amountCents) ?? 0;
          return r.status === RefundStatus.SUCCEEDED && cents > 0;
        });

        if (existingSucceededRefund) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "A successful refund already exists for this ride payment.",
            },
            { status: 400 }
          );
        }

        if (
          !refundablePayment.stripePaymentIntentId &&
          !refundablePayment.stripeChargeId
        ) {
          return NextResponse.json(
            {
              ok: false,
              error: "Ride payment is not linked to a Stripe payment.",
            },
            { status: 400 }
          );
        }

        const paymentFinalAmountCents =
          asNonNegativeCents(refundablePayment.finalAmountCents) ??
          asNonNegativeCents(refundablePayment.amountCents) ??
          0;

        if (paymentFinalAmountCents <= 0) {
          return NextResponse.json(
            {
              ok: false,
              error: "Original payment amount is invalid for refund.",
            },
            { status: 400 }
          );
        }

        if (resolvedRefundAmount > paymentFinalAmountCents) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "Refund amount cannot exceed the original charged amount.",
            },
            { status: 400 }
          );
        }

        const refundTarget =
          refundablePayment.stripePaymentIntentId
            ? { payment_intent: refundablePayment.stripePaymentIntentId }
            : refundablePayment.stripeChargeId
            ? { charge: refundablePayment.stripeChargeId }
            : null;

        if (!refundTarget) {
          return NextResponse.json(
            {
              ok: false,
              error: "Ride payment is not linked to a Stripe payment.",
            },
            { status: 400 }
          );
        }

        const idempotencyKey = buildRefundIdempotencyKey({
          disputeId: existing.id,
          ridePaymentId: refundablePayment.id,
          amountCents: resolvedRefundAmount,
        });

        const pendingProviderRef = buildPendingProviderRef(idempotencyKey);

        const existingPendingRefund = await prisma.refund.findFirst({
          where: {
            ridePaymentId: refundablePayment.id,
            provider: "STRIPE",
            providerRef: pendingProviderRef,
          },
          orderBy: { createdAt: "desc" },
        });

        if (!existingPendingRefund) {
          await prisma.refund.create({
            data: {
              ridePaymentId: refundablePayment.id,
              amountCents: resolvedRefundAmount,
              currency: (existing.booking?.currency ?? "USD").toUpperCase(),
              status: RefundStatus.PENDING,
              provider: "STRIPE",
              providerRef: pendingProviderRef,
              processorFeeLostCents: null,
            },
          });
        }

        try {
          const stripeRefund = await stripe.refunds.create(
            {
              ...refundTarget,
              amount: resolvedRefundAmount,
              metadata: {
                disputeId: existing.id,
                rideId: existing.rideId,
                bookingId: existing.bookingId,
                riderId: existing.riderId,
                driverId: existing.driverId ?? "",
                ridePaymentId: refundablePayment.id,
              },
            },
            {
              idempotencyKey,
            }
          );

          const processorFeeLostCents =
            await resolveProcessorFeeLostCentsFromChargeRefund({
              refund: stripeRefund,
            });

          stripeRefundResult = {
            id: stripeRefund.id,
            status: stripeRefund.status ?? null,
            amount: resolvedRefundAmount,
            ridePaymentId: refundablePayment.id,
            ridePaymentFinalAmountCents: paymentFinalAmountCents,
            processorFeeLostCents,
          };

          nextRefundIssued = true;
          nextRefundAmountCents = resolvedRefundAmount;
          nextRefundIssuedAt = existing.refundIssuedAt ?? new Date();
        } catch (error) {
          await prisma.refund.updateMany({
            where: {
              ridePaymentId: refundablePayment.id,
              provider: "STRIPE",
              providerRef: pendingProviderRef,
              status: RefundStatus.PENDING,
            },
            data: {
              status: RefundStatus.FAILED,
            },
          });

          throw error;
        }
      }
    } else if (nextStatus !== DisputeStatus.RESOLVED_RIDER) {
      nextRefundIssued = existing.refundIssued;
      nextRefundAmountCents = existing.refundAmountCents;
      nextRefundIssuedAt = existing.refundIssuedAt;
    }

    const refundWasJustRecorded =
      existing.refundIssued !== true && nextRefundIssued === true;

    const refundAmountChanged =
      existing.refundAmountCents !== nextRefundAmountCents;

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

      if (stripeRefundResult) {
        const pendingProviderRef = buildPendingProviderRef(
          buildRefundIdempotencyKey({
            disputeId: existing.id,
            ridePaymentId: stripeRefundResult.ridePaymentId,
            amountCents: stripeRefundResult.amount,
          })
        );

        const existingStripeRefundRow = await tx.refund.findFirst({
          where: {
            ridePaymentId: stripeRefundResult.ridePaymentId,
            provider: "STRIPE",
            providerRef: stripeRefundResult.id,
          },
          orderBy: { createdAt: "desc" },
        });

        if (!existingStripeRefundRow) {
          const pendingRow = await tx.refund.findFirst({
            where: {
              ridePaymentId: stripeRefundResult.ridePaymentId,
              provider: "STRIPE",
              providerRef: pendingProviderRef,
            },
            orderBy: { createdAt: "desc" },
          });

          if (pendingRow) {
            await tx.refund.update({
              where: { id: pendingRow.id },
              data: {
                status: normalizeRefundStatus(stripeRefundResult.status),
                providerRef: stripeRefundResult.id,
                ...(stripeRefundResult.processorFeeLostCents != null
                  ? {
                      processorFeeLostCents:
                        stripeRefundResult.processorFeeLostCents,
                    }
                  : {}),
              },
            });
          } else {
            await tx.refund.create({
              data: {
                ridePaymentId: stripeRefundResult.ridePaymentId,
                amountCents: stripeRefundResult.amount,
                currency: (existing.booking?.currency ?? "USD").toUpperCase(),
                status: normalizeRefundStatus(stripeRefundResult.status),
                provider: "STRIPE",
                providerRef: stripeRefundResult.id,
                processorFeeLostCents: stripeRefundResult.processorFeeLostCents,
              },
            });
          }
        }

        const fullyRefunded =
          stripeRefundResult.amount >=
          stripeRefundResult.ridePaymentFinalAmountCents;

        await tx.ridePayment.update({
          where: { id: stripeRefundResult.ridePaymentId },
          data: {
            status: fullyRefunded
              ? RidePaymentStatus.REFUNDED
              : RidePaymentStatus.SUCCEEDED,
          },
        });
      }

      if (refundWasJustRecorded) {
        await tx.adminAuditLog.create({
          data: {
            adminUserId: adminId,
            disputeId: dispute.id,
            actionType: AdminActionType.FALLBACK_CHARGE_REFUNDED,
            targetType: AdminTargetType.DISPUTE,
            targetId: dispute.id,
            notes:
              adminNotes ||
              `Refund recorded for ${dispute.refundAmountCents ?? 0} cents.`,
            metadata: {
              disputeId: dispute.id,
              bookingId: dispute.bookingId,
              rideId: dispute.rideId,
              refundIssued: dispute.refundIssued,
              refundAmountCents: dispute.refundAmountCents ?? 0,
              refundIssuedAt: dispute.refundIssuedAt?.toISOString() ?? null,
              stripeRefundId: stripeRefundResult?.id ?? null,
              stripeRefundStatus: stripeRefundResult?.status ?? null,
              processorFeeLostCents:
                stripeRefundResult?.processorFeeLostCents ?? null,
            },
          },
        });

        await tx.notification.create({
          data: {
            userId: existing.riderId,
            rideId: existing.rideId,
            bookingId: existing.bookingId,
            type: NotificationType.REFUND_ISSUED,
            title: "Refund issued",
            message: `A refund of ${(
              (dispute.refundAmountCents ?? 0) / 100
            ).toFixed(2)} ${(existing.booking?.currency ?? "USD").toUpperCase()} was issued for this dispute.`,
            metadata: {
              disputeId: existing.id,
              bookingId: existing.bookingId,
              rideId: existing.rideId,
              refundAmountCents: dispute.refundAmountCents ?? 0,
              stripeRefundId: stripeRefundResult?.id ?? null,
              processorFeeLostCents:
                stripeRefundResult?.processorFeeLostCents ?? null,
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
              title: "Refund issued",
              message:
                "An admin issued a refund for this fallback charge dispute.",
              metadata: {
                disputeId: existing.id,
                bookingId: existing.bookingId,
                rideId: existing.rideId,
                refundAmountCents: dispute.refundAmountCents ?? 0,
                stripeRefundId: stripeRefundResult?.id ?? null,
                processorFeeLostCents:
                  stripeRefundResult?.processorFeeLostCents ?? null,
              },
            },
          });
        }
      } else if (
        nextStatus === DisputeStatus.RESOLVED_RIDER &&
        existing.refundIssued === true &&
        refundAmountChanged
      ) {
        await tx.adminAuditLog.create({
          data: {
            adminUserId: adminId,
            disputeId: dispute.id,
            actionType: AdminActionType.FALLBACK_CHARGE_REFUNDED,
            targetType: AdminTargetType.DISPUTE,
            targetId: dispute.id,
            notes:
              adminNotes ||
              `Refund amount updated to ${dispute.refundAmountCents ?? 0} cents.`,
            metadata: {
              disputeId: dispute.id,
              bookingId: dispute.bookingId,
              rideId: dispute.rideId,
              refundIssued: dispute.refundIssued,
              refundAmountCents: dispute.refundAmountCents ?? 0,
              refundIssuedAt: dispute.refundIssuedAt?.toISOString() ?? null,
              refundAmountUpdated: true,
            },
          },
        });
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
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}