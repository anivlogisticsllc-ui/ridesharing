// app/api/admin/rides/[rideId]/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// Support both shapes (Next versions vary)
type Ctx = { params: { rideId: string } | Promise<{ rideId: string }> };

function toIsoOrNull(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

export async function GET(_: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role as string | undefined;

  if (!session) return jsonError(401, "Not authenticated");
  if (role !== "ADMIN") return jsonError(403, "Admin only");

  const params = await Promise.resolve(ctx.params);
  const rideId = decodeURIComponent(params?.rideId || "");
  if (!rideId) return jsonError(400, "Missing rideId");

  try {
    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        driver: { select: { id: true, name: true, email: true, publicId: true } },
        rider: { select: { id: true, name: true, email: true } },
        bookings: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,

            paymentType: true,
            cashDiscountBps: true,

            originalPaymentType: true,
            originalCashDiscountBps: true,

            baseAmountCents: true,
            discountCents: true,
            finalAmountCents: true,
            currency: true,

            cashNotPaidAt: true,
            cashNotPaidByUserId: true,

            cashDiscountRevokedAt: true,
            cashDiscountRevokedReason: true,

            fallbackCardChargedAt: true,

            stripePaymentIntentId: true,
            stripePaymentIntentStatus: true,

            cashNotPaidNote: true,
            cashNotPaidReportedById: true,

            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!ride) return jsonError(404, "Ride not found");

    const latestBooking = ride.bookings?.[0] ?? null;

    // Resolve “reported by / marked by” into name/email
    const idsToResolve = new Set<string>();
    if (latestBooking?.cashNotPaidReportedById) idsToResolve.add(String(latestBooking.cashNotPaidReportedById));
    if (latestBooking?.cashNotPaidByUserId) idsToResolve.add(String(latestBooking.cashNotPaidByUserId));

    const resolvedUsers =
      idsToResolve.size > 0
        ? await prisma.user.findMany({
            where: { id: { in: Array.from(idsToResolve) } },
            select: { id: true, name: true, email: true, role: true },
          })
        : [];

    const userMap = new Map(resolvedUsers.map((u) => [u.id, u]));

    const shaped = {
      ...ride,
      departureTime: toIsoOrNull(ride.departureTime),
      tripStartedAt: toIsoOrNull(ride.tripStartedAt),
      tripCompletedAt: toIsoOrNull(ride.tripCompletedAt),
      createdAt: toIsoOrNull(ride.createdAt),
      updatedAt: toIsoOrNull(ride.updatedAt),

      latestBooking: latestBooking
        ? {
            ...latestBooking,
            createdAt: toIsoOrNull(latestBooking.createdAt),
            updatedAt: toIsoOrNull(latestBooking.updatedAt),

            cashNotPaidAt: toIsoOrNull(latestBooking.cashNotPaidAt),
            cashDiscountRevokedAt: toIsoOrNull(latestBooking.cashDiscountRevokedAt),
            fallbackCardChargedAt: toIsoOrNull(latestBooking.fallbackCardChargedAt),

            // richer objects for UI
            cashNotPaidReportedBy: latestBooking.cashNotPaidReportedById
              ? userMap.get(String(latestBooking.cashNotPaidReportedById)) ?? null
              : null,
            cashNotPaidMarkedBy: latestBooking.cashNotPaidByUserId
              ? userMap.get(String(latestBooking.cashNotPaidByUserId)) ?? null
              : null,
          }
        : null,

      // keep your “latestBooking only” API contract
      bookings: undefined as never,
    };

    return NextResponse.json(
      { ok: true, ride: shaped },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    console.error("[api/admin/rides/[rideId]] error:", e);
    return jsonError(500, e?.message || "Internal server error");
  }
}