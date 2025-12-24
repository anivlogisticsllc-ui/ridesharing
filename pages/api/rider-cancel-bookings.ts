// pages/api/rider-cancel-booking.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import { prisma } from "../../lib/prisma";
import { BookingStatus } from "@prisma/client";

type ApiResponse =
  | { ok: true; bookingId: string; status: BookingStatus }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);

  // Widen the user type so TS knows about id (and role if needed later)
  const user = session?.user as
    | ({
        id?: string;
        name?: string | null;
        email?: string | null;
        image?: string | null;
      } & {
        role?: "RIDER" | "DRIVER";
      })
    | undefined;

  if (!user?.id) {
    return res
      .status(401)
      .json({ ok: false, error: "Not authenticated" });
  }

  const userId = user.id;
  const { bookingId } = (req.body ?? {}) as { bookingId?: string };

  if (!bookingId || typeof bookingId !== "string") {
    return res
      .status(400)
      .json({ ok: false, error: "bookingId is required" });
  }

  try {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, riderId: userId },
    });

    if (!booking) {
      return res
        .status(404)
        .json({ ok: false, error: "Booking not found for this rider" });
    }

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED },
    });

    return res.status(200).json({
      ok: true,
      bookingId: updated.id,
      status: updated.status,
    });
  } catch (err: any) {
    console.error("Error cancelling booking:", err);
    return res.status(500).json({
      ok: false,
      error:
        err?.message && process.env.NODE_ENV === "development"
          ? err.message
          : "Failed to cancel booking",
    });
  }
}
