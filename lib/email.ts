// lib/email.ts
import nodemailer, { type Transporter } from "nodemailer";

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 587);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

// Optional override if you ever need it (leave unset for Gmail)
const secureEnv = process.env.SMTP_SECURE; // "true" | "false" | undefined

function isSecurePort(p: number) {
  return p === 465; // implicit TLS
}

function getTransport(): Transporter | null {
  if (!host || !user || !pass) {
    console.warn("[EMAIL] SMTP configuration is missing. Emails will NOT be sent.");
    return null;
  }

  const secure =
    typeof secureEnv === "string"
      ? secureEnv.toLowerCase() === "true"
      : isSecurePort(port);

  // For Gmail STARTTLS on 587, requireTLS helps avoid silent downgrade issues.
  const requireTLS = !secure && port === 587;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    ...(requireTLS ? { requireTLS: true } : {}),
  });
}

function fromLine() {
  // If you ever want a different "from" later, add SMTP_FROM in env and prefer it here.
  // For now keep it simple and consistent.
  return `"RideShare" <${user || "no-reply@rideshare.local"}>`;
}

function wrapHtml(title: string, bodyHtml: string) {
  return `
    <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 16px;">
      <h2 style="margin: 0 0 10px; font-size: 20px; color:#0f172a;">${title}</h2>
      ${bodyHtml}
    </div>
  `;
}

async function sendOrLog(args: {
  to: string;
  subject: string;
  html: string;
}) {
  const transporter = getTransport();
  if (!transporter) {
    console.log("[EMAIL] (dry-run) To:", args.to);
    console.log("[EMAIL] (dry-run) Subject:", args.subject);
    return { ok: true as const, dryRun: true as const };
  }

  const info = await transporter.sendMail({
    from: fromLine(),
    to: args.to,
    subject: args.subject,
    html: args.html,
  });

  // This is the log you want when troubleshooting Gmail delivery.
  console.log("[EMAIL] messageId:", info.messageId);
  console.log("[EMAIL] accepted:", info.accepted);
  console.log("[EMAIL] rejected:", info.rejected);
  console.log("[EMAIL] response:", info.response);

  return { ok: true as const, dryRun: false as const, info };
}

/* ---------- Email verification ---------- */

export async function sendVerificationEmail(to: string, verifyUrl: string) {
  console.log("[EMAIL] sendVerificationEmail ->", to, "host:", host, "port:", port);

  const html = wrapHtml(
    "Confirm your email",
    `
      <p style="margin: 0 0 14px; font-size: 14px; color: #475569;">
        Thanks for creating an account. Please verify your email below:
      </p>
      <p style="margin: 0 0 14px;">
        <a href="${verifyUrl}"
           style="background:#2563eb;color:white;padding:10px 16px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:600;font-size:14px;">
          Verify Email
        </a>
      </p>
      <p style="margin: 0 0 6px; font-size: 12px; color: #64748b;">
        If the button doesn’t work, copy and paste this URL:
      </p>
      <p style="margin: 0; font-size: 12px; color: #0f172a; word-break: break-all;">
        ${verifyUrl}
      </p>
    `
  );

  try {
    await sendOrLog({ to, subject: "Verify your email", html });
  } catch (err) {
    console.error("[EMAIL] Error sending verification email:", err);
  }
}

/* ---------- Password reset email ---------- */

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  console.log("[EMAIL] sendPasswordResetEmail ->", to);

  const html = wrapHtml(
    "Reset your password",
    `
      <p style="margin: 0 0 14px; font-size: 14px; color: #475569;">
        We received a request to reset the password for your account.
      </p>
      <p style="margin: 0 0 14px;">
        <a href="${resetUrl}"
           style="background:#2563eb;color:white;padding:10px 16px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:600;font-size:14px;">
          Set a new password
        </a>
      </p>
      <p style="margin: 0 0 6px; font-size: 12px; color: #64748b;">
        If the button doesn’t work, copy and paste this URL:
      </p>
      <p style="margin: 0 0 14px; font-size: 12px; color: #0f172a; word-break: break-all;">
        ${resetUrl}
      </p>
      <p style="margin: 0; font-size: 12px; color: #64748b;">
        If you didn’t request this, you can safely ignore this email.
      </p>
    `
  );

  try {
    await sendOrLog({ to, subject: "Reset your password", html });
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

function formatMoneyFromCents(cents: number | null | undefined) {
  const v = typeof cents === "number" ? cents : 0;
  return (v / 100).toFixed(2);
}
function formatMiles(miles: number | null | undefined) {
  const v = typeof miles === "number" ? miles : 0;
  return v.toFixed(2);
}
function fmtDate(d: Date | null | undefined) {
  return d ? d.toLocaleString() : "n/a";
}

function riderReceiptHtml(args: {
  riderName?: string | null;
  driverName?: string | null;
  ride: RideReceiptSnapshot;
}) {
  const { riderName, driverName, ride } = args;

  const amount = formatMoneyFromCents(ride.totalPriceCents);
  const miles = formatMiles(ride.distanceMiles);

  const prettyDate = fmtDate(ride.departureTime);
  const started = fmtDate(ride.tripStartedAt);
  const completed = fmtDate(ride.tripCompletedAt);

  return `
    <p style="margin: 0 0 18px; font-size: 14px; color: #475569;">
      Here is your receipt for the completed trip${riderName ? `, ${riderName}` : ""}.
    </p>

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
          <div style="font-size:20px; font-weight:700; color:#0f172a;">$${amount}</div>
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
          <div style="margin-top:3px; font-weight:600;">${ride.passengerCount ?? "n/a"}</div>
        </div>
      </div>
    </div>

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
          <div style="margin-top:3px; font-weight:500;">${ride.destinationCity}</div>
          <div style="margin-top:2px; font-size:11px; color:#94a3b8;">
            (${ride.destinationLat.toFixed(4)}, ${ride.destinationLng.toFixed(4)})
          </div>
        </div>
        <div style="flex:1 1 180px;">
          <div style="font-size:11px; color:#94a3b8;">Driver</div>
          <div style="margin-top:3px; font-weight:500;">${driverName || "Your driver"}</div>
          <div style="margin-top:2px; font-size:11px; color:#94a3b8;">Ride ID: ${ride.id}</div>
        </div>
      </div>
    </div>

    <p style="margin: 0; font-size: 12px; color: #94a3b8;">
      If you have questions about this charge, reply to this email with your ride ID.
    </p>
  `;
}

function driverReceiptHtml(args: {
  driverName?: string | null;
  riderName?: string | null;
  ride: RideReceiptSnapshot;
}) {
  const { driverName, riderName, ride } = args;

  const amount = formatMoneyFromCents(ride.totalPriceCents);
  const miles = formatMiles(ride.distanceMiles);

  return `
    <p style="margin: 0 0 18px; font-size: 14px; color: #475569;">
      Driver copy for a completed trip${driverName ? `, ${driverName}` : ""}.
    </p>

    <div style="border-radius: 14px; border: 1px solid #e2e8f0; padding: 16px; background:#ffffff; margin-bottom:16px;">
      <div style="font-size:15px; font-weight:600; color:#0f172a; margin-bottom:6px;">
        ${ride.originCity} → ${ride.destinationCity}
      </div>
      <div style="font-size:13px; color:#334155; margin-bottom:8px;">
        Passenger: <b>${riderName || "Unknown"}</b>
      </div>

      <div style="display:flex; flex-wrap:wrap; gap:16px; font-size:13px; color:#334155;">
        <div style="flex:1 1 120px;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Distance</div>
          <div style="margin-top:3px; font-weight:600;">${miles} miles</div>
        </div>
        <div style="flex:1 1 120px;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Total</div>
          <div style="margin-top:3px; font-weight:700;">$${amount}</div>
        </div>
        <div style="flex:1 1 180px;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Ride ID</div>
          <div style="margin-top:3px; font-weight:500;">${ride.id}</div>
        </div>
      </div>
    </div>

    <p style="margin: 0; font-size: 12px; color: #94a3b8;">
      If you need help with this trip, reply with the ride ID.
    </p>
  `;
}

export async function sendRideReceiptEmail(args: {
  riderEmail: string;
  riderName?: string | null;
  driverName?: string | null;
  ride: RideReceiptSnapshot;
}) {
  const subject = `Your ride receipt • ${args.ride.originCity} → ${args.ride.destinationCity}`;
  const html = wrapHtml("Ride receipt", riderReceiptHtml(args));

  try {
    await sendOrLog({ to: args.riderEmail, subject, html });
  } catch (err) {
    console.error("[EMAIL] sendRideReceiptEmail failed:", err);
    throw err;
  }
}

export async function sendDriverReceiptEmail(args: {
  driverEmail: string;
  driverName?: string | null;
  riderName?: string | null;
  ride: RideReceiptSnapshot;
}) {
  const subject = `Driver receipt • ${args.ride.originCity} → ${args.ride.destinationCity}`;
  const html = wrapHtml("Ride receipt (Driver copy)", driverReceiptHtml(args));

  try {
    await sendOrLog({ to: args.driverEmail, subject, html });
  } catch (err) {
    console.error("[EMAIL] sendDriverReceiptEmail failed:", err);
    throw err;
  }
}
