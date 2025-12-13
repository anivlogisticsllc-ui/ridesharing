// lib/email.ts
import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 587);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

function getTransport() {
  if (!host || !user || !pass) {
    console.warn(
      "[EMAIL] SMTP configuration is missing. Emails will NOT be sent."
    );
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user, pass },
  });
}

/* ---------- Email verification ---------- */

export async function sendVerificationEmail(to: string, verifyUrl: string) {
  console.log("[EMAIL] sendVerificationEmail called for:", to);
  console.log("[EMAIL] Using host:", host, "port:", port);

  const transporter = getTransport();
  if (!transporter) {
    console.log("[EMAIL] Would send verification email to:", to);
    console.log("[EMAIL] Link:", verifyUrl);
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"Ridesharing App" <${user}>`,
      to,
      subject: "Verify your email",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>Confirm your email</h2>
          <p>Thanks for creating an account. Please verify your email below:</p>
          <p>
            <a href="${verifyUrl}"
               style="background: #007bff; color: white; padding: 10px 16px; text-decoration: none;
                      border-radius: 4px; display: inline-block;">
              Verify Email
            </a>
          </p>
          <p>If the button doesn't work, copy & paste this URL:</p>
          <p>${verifyUrl}</p>
        </div>
      `,
    });

    console.log("[EMAIL] Message sent:", info.messageId);
  } catch (err) {
    console.error("[EMAIL] Error sending verification email:", err);
  }
}

/* ---------- Password reset email (NEW) ---------- */

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  console.log("[EMAIL] sendPasswordResetEmail called for:", to);

  const transporter = getTransport();
  if (!transporter) {
    console.log("[EMAIL] Would send password reset email to:", to);
    console.log("[EMAIL] Link:", resetUrl);
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"Ridesharing App" <${user}>`,
      to,
      subject: "Reset your password",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>Reset your password</h2>
          <p>We received a request to reset the password for your account.</p>
          <p>
            <a href="${resetUrl}"
               style="background: #007bff; color: white; padding: 10px 16px; text-decoration: none;
                      border-radius: 4px; display: inline-block;">
              Set a new password
            </a>
          </p>
          <p>If the button doesn't work, copy & paste this URL into your browser:</p>
          <p>${resetUrl}</p>
          <p style="font-size: 12px; color: #6b7280;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      `,
    });

    console.log("[EMAIL] Password reset email sent:", info.messageId);
  } catch (err) {
    console.error("[EMAIL] Error sending password reset email:", err);
  }
}

/* ---------- Ride receipt email ---------- */

export type RideReceiptSnapshot = {
  id: string;
  status: string;
  originCity: string;
  originLat: number;
  originLng: number;
  destinationCity: string;
  destinationLat: number;
  destinationLng: number;
  departureTime: Date;
  tripStartedAt: Date | null;
  tripCompletedAt: Date | null;
  passengerCount: number | null;
  distanceMiles: number | null;
  totalPriceCents: number | null;
};

export async function sendRideReceiptEmail(args: {
  riderEmail: string;
  riderName?: string | null;
  driverName?: string | null;
  ride: RideReceiptSnapshot;
}) {
  const { riderEmail, riderName, driverName, ride } = args;
  const transporter = getTransport();

  if (!transporter) {
    console.log(
      "[EMAIL] Would send ride receipt to:",
      riderEmail,
      "for ride:",
      ride.id
    );
    return;
  }

  const amount =
    typeof ride.totalPriceCents === "number"
      ? (ride.totalPriceCents / 100).toFixed(2)
      : "0.00";

  const miles =
    typeof ride.distanceMiles === "number"
      ? ride.distanceMiles.toFixed(2)
      : "0.00";

  const prettyDate = ride.departureTime.toLocaleString();
  const started = ride.tripStartedAt
    ? ride.tripStartedAt.toLocaleString()
    : "n/a";
  const completed = ride.tripCompletedAt
    ? ride.tripCompletedAt.toLocaleString()
    : "n/a";

  const subject = `Your ride receipt • ${ride.originCity} → ${ride.destinationCity}`;

  const html = `
    <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 16px;">
      <h2 style="margin: 0 0 8px; font-size: 20px;">Thanks for riding with us${
        riderName ? `, ${riderName}` : ""
      }.</h2>
      <p style="margin: 0 0 18px; font-size: 14px; color: #475569;">
        Here is your receipt for the completed trip.
      </p>

      <!-- Trip summary block (mirrors Driver Ride Details) -->
      <div style="border-radius: 14px; border: 1px solid #e2e8f0; padding: 16px; margin-bottom: 16px; background:#ffffff;">
        <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:12px;">
          <div>
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#64748b; margin-bottom:4px;">Route</div>
            <div style="font-size:15px; font-weight:600; color:#0f172a;">
              ${ride.originCity} → ${ride.destinationCity}
            </div>
            <div style="font-size:12px; color:#64748b; margin-top:3px;">
              Scheduled departure • ${prettyDate}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#64748b; margin-bottom:4px;">Total fare</div>
            <div style="font-size:20px; font-weight:700; color:#0f172a;">
              $${amount}
            </div>
            <div style="font-size:11px; color:#94a3b8; margin-top:2px;">
              Stored as ${ride.totalPriceCents ?? 0} cents
            </div>
          </div>
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:16px; font-size:13px; color:#334155; margin-top:4px;">
          <div style="flex:1 1 120px;">
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Trip status</div>
            <div style="margin-top:3px; font-weight:600;">${ride.status}</div>
          </div>
          <div style="flex:1 1 120px;">
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Distance</div>
            <div style="margin-top:3px; font-weight:600;">${miles} miles</div>
          </div>
          <div style="flex:1 1 120px;">
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Passengers</div>
            <div style="margin-top:3px; font-weight:600;">${
              ride.passengerCount ?? "n/a"
            }</div>
          </div>
        </div>
      </div>

      <!-- Timing block -->
      <div style="border-radius: 14px; border: 1px solid #e2e8f0; padding: 16px; margin-bottom: 16px; background:#ffffff;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; margin-bottom:6px;">Timing</div>
        <div style="display:flex; flex-wrap:wrap; gap:16px; font-size:13px; color:#334155;">
          <div style="flex:1 1 180px;">
            <div style="font-size:11px; color:#94a3b8;">Scheduled departure</div>
            <div style="margin-top:3px; font-weight:500;">${prettyDate}</div>
          </div>
          <div style="flex:1 1 180px;">
            <div style="font-size:11px; color:#94a3b8;">Trip started</div>
            <div style="margin-top:3px; font-weight:500;">${started}</div>
          </div>
          <div style="flex:1 1 180px;">
            <div style="font-size:11px; color:#94a3b8;">Trip completed</div>
            <div style="margin-top:3px; font-weight:500;">${completed}</div>
          </div>
        </div>
      </div>

      <!-- Route coordinates + meta -->
      <div style="border-radius: 14px; border: 1px solid #e2e8f0; padding: 16px; background:#ffffff; margin-bottom:16px;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; margin-bottom:6px;">Route details</div>
        <div style="display:flex; flex-wrap:wrap; gap:16px; font-size:13px; color:#334155;">
          <div style="flex:1 1 220px;">
            <div style="font-size:11px; color:#94a3b8;">Pickup</div>
            <div style="margin-top:3px; font-weight:500;">${ride.originCity}</div>
            <div style="margin-top:2px; font-size:11px; color:#94a3b8;">
              (${ride.originLat.toFixed(4)}, ${ride.originLng.toFixed(4)})
            </div>
          </div>
          <div style="flex:1 1 220px;">
            <div style="font-size:11px; color:#94a3b8;">Dropoff</div>
            <div style="margin-top:3px; font-weight:500;">${
              ride.destinationCity
            }</div>
            <div style="margin-top:2px; font-size:11px; color:#94a3b8;">
              (${ride.destinationLat.toFixed(4)}, ${ride.destinationLng.toFixed(
    4
  )})
            </div>
          </div>
          <div style="flex:1 1 180px;">
            <div style="font-size:11px; color:#94a3b8;">Driver</div>
            <div style="margin-top:3px; font-weight:500;">${
              driverName || "Your driver"
            }</div>
            <div style="margin-top:2px; font-size:11px; color:#94a3b8;">
              Ride ID: ${ride.id}
            </div>
          </div>
        </div>
      </div>

      <p style="margin: 0 0 4px; font-size: 12px; color: #94a3b8;">
        If you have questions about this charge, reply to this email with your ride ID.
      </p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: `"Ridesharing App" <${user}>`,
    to: riderEmail,
    subject,
    html,
  });

  console.log(
    "[EMAIL] Sent ride receipt for",
    ride.id,
    "to",
    riderEmail,
    "messageId=",
    info.messageId
  );
}
