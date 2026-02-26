import { sendEmail } from "@/lib/email";

export async function sendOutstandingChargePaidEmail(args: {
  riderEmail: string;
  riderName?: string | null;
  outstandingChargeId: string;
  rideId?: string | null;
  amountCents: number;
  paymentType: "CARD" | "CASH" | string;
}) {
  const amount = (Math.max(0, Math.round(args.amountCents)) / 100).toFixed(2);
  const payment = String(args.paymentType || "CARD").toUpperCase();

  const text = [
    "Payment received",
    "",
    `Amount: $${amount}`,
    `Method: ${payment}`,
    `Outstanding Charge ID: ${args.outstandingChargeId}`,
    args.rideId ? `Ride ID: ${args.rideId}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return sendEmail({
    to: args.riderEmail,
    subject: "Payment received",
    text,
  });
}