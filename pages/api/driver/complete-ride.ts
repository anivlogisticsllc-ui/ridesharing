// pages/api/driver/complete-ride.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { RideStatus, BookingStatus } from "@prisma/client";
import nodemailer from "nodemailer";

type ApiResponse = { ok: true } | { ok: false; error: string };

type CompleteRideBody = {
  rideId?: string;
  elapsedSeconds?: number | null; // currently unused, but kept for future
  distanceMiles?: number | null;
  fareCents?: number | null;
};

/**
 * Sends a ride receipt email to the rider using Gmail SMTP.
 * Expects GMAIL_USER and GMAIL_PASS to be set in env.
 */
async function sendRideReceiptEmail(args: {
  riderEmail: string;
  riderName?: string | null;
  driverName?: string | null;
  ride: {
    id: string;
    originCity: string;
    destinationCity: string;
    departureTime: Date;
    distanceMiles?: number | null;
    totalPriceCents?: number | null;
  };
}) {
  const { riderEmail, riderName, driverName, ride } = args;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_PASS;

  if (!user || !pass) {
    console.warn(
      "[receipt-email] GMAIL_USER / GMAIL_PASS not set. Skipping email send."
    );
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  const amount =
    typeof ride.totalPriceCents === "number"
      ? (ride.totalPriceCents / 100).toFixed(2)
      : "0.00";

  const miles =
    typeof ride.distanceMiles === "number"
      ? ride.distanceMiles.toFixed(2)
      : "0.00";

  const subject = `Your ride receipt • ${ride.originCity} → ${ride.destinationCity}`;
  const prettyDate = ride.departureTime.toLocaleString();

  const html = `
    <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 540px; margin: 0 auto; padding: 16px;">
      <h2 style="margin: 0 0 8px; font-size: 18px;">Thanks for riding with us${
        riderName ? `, ${riderName}` : ""
      }.</h2>
      <p style="margin: 0 0 16px; font-size: 14px; color: #475569;">
        Here is your receipt for the completed trip.
      </p>

      <div style="border-radius: 12px; border: 1px solid #e2e8f0; padding: 16px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <div>
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #64748b; margin-bottom: 4px;">Route</div>
            <div style="font-size: 14px; font-weight: 600; color: #0f172a;">
              ${ride.originCity} → ${ride.destinationCity}
            </div>
            <div style="font-size: 12px; color: #64748b; margin-top: 2px;">
              ${prettyDate}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #64748b; margin-bottom: 4px;">Total</div>
            <div style="font-size: 18px; font-weight: 700; color: #0f172a;">
              $${amount}
            </div>
          </div>
        </div>

        <div style="margin-top: 10px; display: flex; justify-content: space-between; font-size: 12px; color: #475569;">
          <div>
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #94a3b8;">Distance</div>
            <div style="margin-top: 2px;">${miles} miles</div>
          </div>
          <div>
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #94a3b8;">Driver</div>
            <div style="margin-top: 2px;">${driverName || "Your driver"}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #94a3b8;">Ride ID</div>
            <div style="margin-top: 2px;">${ride.id}</div>
          </div>
        </div>
      </div>

      <p style="margin: 0 0 4px; font-size: 12px; color: #94a3b8;">
        If you have questions about this charge, reply to this email with your ride ID.
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: user,
    to: riderEmail,
    subject,
    html,
  });

  console.log(
    `[receipt-email] Sent ride receipt for ${ride.id} to ${riderEmail}`
  );
}

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

  const user = session?.user as
    | ({
        id?: string;
        name?: string | null;
        email?: string | null;
        image?: string | null;
      } & { role?: string })
    | undefined;

  if (!user?.id) {
    return res
      .status(401)
      .json({ ok: false, error: "Not authenticated" });
  }

  const driverId = user.id;
  const { rideId, elapsedSeconds, distanceMiles, fareCents } =
    req.body as CompleteRideBody;

  if (!rideId) {
    return res
      .status(400)
      .json({ ok: false, error: "rideId is required" });
  }

  // Fetch ride + primary booking + rider + driver
  const ride = await prisma.ride.findFirst({
    where: {
      id: rideId,
      driverId,
    },
    include: {
      bookings: {
        where: {
          status: {
            in: [BookingStatus.ACCEPTED, BookingStatus.COMPLETED],
          },
        },
        take: 1,
        include: { rider: true },
      },
      driver: true,
    },
  });

  if (!ride) {
    return res
      .status(404)
      .json({ ok: false, error: "Ride not found for this driver." });
  }

  // Idempotent: already completed
  if (ride.status === RideStatus.COMPLETED) {
    return res.status(200).json({ ok: true });
  }

  if (
    ride.status !== RideStatus.ACCEPTED &&
    ride.status !== RideStatus.IN_ROUTE
  ) {
    return res.status(400).json({
      ok: false,
      error: `Ride must be in ACCEPTED or IN_ROUTE to complete (current: ${ride.status}).`,
    });
  }

  const booking = ride.bookings[0] ?? null;

  // Use provided metrics if available, otherwise keep existing DB values
  const updatedDistanceMiles =
    typeof distanceMiles === "number" ? distanceMiles : ride.distanceMiles;
  const updatedFareCents =
    typeof fareCents === "number" ? fareCents : ride.totalPriceCents;

  const completionTime = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.ride.update({
      where: { id: ride.id },
      data: {
        status: RideStatus.COMPLETED,
        tripCompletedAt: completionTime,
        distanceMiles: updatedDistanceMiles ?? undefined,
        totalPriceCents: updatedFareCents ?? undefined,
      },
    });

    if (booking) {
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.COMPLETED,
        },
      });
    }
  });

  // Fire-and-forget email receipt
  if (booking?.rider?.email) {
    sendRideReceiptEmail({
      riderEmail: booking.rider.email,
      riderName: booking.rider.name,
      driverName: ride.driver?.name,
      ride: {
        id: ride.id,
        originCity: ride.originCity,
        destinationCity: ride.destinationCity,
        departureTime: ride.departureTime,
        distanceMiles: updatedDistanceMiles ?? undefined,
        totalPriceCents: updatedFareCents ?? undefined,
      },
    }).catch((err) => {
      console.error("[receipt-email] Failed to send receipt:", err);
    });
  } else {
    console.log(
      `[receipt-email] No rider email available for ride ${ride.id}, skipping email.`
    );
  }

  return res.status(200).json({ ok: true });
}
