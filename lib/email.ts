// lib/email.ts
import nodemailer, { type Transporter } from "nodemailer";

/* -------------------- Transport -------------------- */

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 587);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

// Optional override if you ever need it
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
    typeof secureEnv === "string" ? secureEnv.toLowerCase() === "true" : isSecurePort(port);

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
  return `"RideShare" <${user || "no-reply@rideshare.local"}>`;
}

/* -------------------- Helpers -------------------- */

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wrapHtml(title: string, bodyHtml: string) {
  return `
    <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 16px;">
      <h2 style="margin: 0 0 10px; font-size: 20px; color:#0f172a;">${escapeHtml(title)}</h2>
      ${bodyHtml}
    </div>
  `;
}

/**
 * Canonical app URL for building links in emails.
 * Priority:
 *  1) APP_URL (recommended)
 *  2) NEXTAUTH_URL (since you already set it)
 *  3) VERCEL_URL (auto, no protocol)
 *  4) localhost fallback
 */
function getAppUrl(): string {
  const raw =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL;

  if (raw && raw.trim()) return raw.replace(/\/$/, "");

  const vercel = process.env.VERCEL_URL;
  if (vercel && vercel.trim()) return `https://${vercel.replace(/\/$/, "")}`;

  return "http://localhost:3000";
}

/**
 * Ensures URLs in emails always point at production base, even if caller passes:
 * - relative path: "/auth/verify?token=..."
 * - localhost url: "http://localhost:3000/auth/verify?token=..."
 */
function normalizeAppUrl(inputUrl: string): string {
  const base = getAppUrl();

  const trimmed = (inputUrl || "").trim();
  if (!trimmed) return base;

  // Relative path -> absolute
  if (trimmed.startsWith("/")) return `${base}${trimmed}`;

  // If it's already the correct base, keep it
  if (trimmed.startsWith(base)) return trimmed;

  // Rewrite localhost links to production base
  if (trimmed.startsWith("http://localhost") || trimmed.startsWith("https://localhost")) {
    try {
      const u = new URL(trimmed);
      return `${base}${u.pathname}${u.search}${u.hash}`;
    } catch {
      return `${base}/`;
    }
  }

  // Any other absolute URL: keep as-is (devil’s advocate: avoids breaking intentional external links)
  return trimmed;
}

async function sendOrLog(args: { to: string; subject: string; html: string; text?: string }) {
  const transporter = getTransport();
  if (!transporter) {
    console.log("[EMAIL] (dry-run) To:", args.to);
    console.log("[EMAIL] (dry-run) Subject:", args.subject);
    if (args.text) console.log("[EMAIL] (dry-run) Text:", args.text.slice(0, 800));
    return { ok: true as const, dryRun: true as const };
  }

  const info = await transporter.sendMail({
    from: fromLine(),
    to: args.to,
    subject: args.subject,
    html: args.html,
    ...(args.text ? { text: args.text } : {}),
  });

  console.log("[EMAIL] messageId:", info.messageId);
  console.log("[EMAIL] accepted:", info.accepted);
  console.log("[EMAIL] rejected:", info.rejected);
  console.log("[EMAIL] response:", info.response);

  return { ok: true as const, dryRun: false as const, info };
}

export async function sendEmail(args: { to: string; subject: string; html?: string; text?: string }) {
  const html =
    args.html ??
    wrapHtml(
      args.subject,
      `<p style="margin:0; font-size:14px; color:#475569;">${escapeHtml(args.text || "")}</p>`
    );

  return sendOrLog({ to: args.to, subject: args.subject, html, text: args.text });
}

function formatMoneyFromCents(cents: number | null | undefined) {
  const v = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  return (v / 100).toFixed(2);
}

function formatMiles(miles: number | null | undefined) {
  const v = typeof miles === "number" && Number.isFinite(miles) ? miles : 0;
  return v.toFixed(2);
}

function fmtDate(d: Date | null | undefined) {
  return d ? d.toLocaleString() : "n/a";
}

function normalizeCents(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

/* -------------------- Auth emails -------------------- */

export async function sendVerificationEmail(to: string, verifyUrl: string) {
  const fixedUrl = normalizeAppUrl(verifyUrl);
  const safeUrl = escapeHtml(fixedUrl);

  const html = wrapHtml(
    "Confirm your email",
    `
      <p style="margin: 0 0 14px; font-size: 14px; color:#475569;">
        Thanks for creating an account. Please verify your email below:
      </p>
      <p style="margin: 0 0 14px;">
        <a href="${safeUrl}"
           style="background:#2563eb;color:white;padding:10px 16px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:600;font-size:14px;">
          Verify Email
        </a>
      </p>
      <p style="margin: 0 0 6px; font-size: 12px; color:#64748b;">
        If the button doesn’t work, copy and paste this URL:
      </p>
      <p style="margin: 0; font-size: 12px; color:#0f172a; word-break: break-all;">
        ${safeUrl}
      </p>
    `
  );

  const text = ["Confirm your email", "", "Verify your email using the link below:", fixedUrl].join(
    "\n"
  );
  await sendOrLog({ to, subject: "Verify your email", html, text });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const fixedUrl = normalizeAppUrl(resetUrl);
  const safeUrl = escapeHtml(fixedUrl);

  const html = wrapHtml(
    "Reset your password",
    `
      <p style="margin: 0 0 14px; font-size: 14px; color:#475569;">
        We received a request to reset the password for your account.
      </p>
      <p style="margin: 0 0 14px;">
        <a href="${safeUrl}"
           style="background:#2563eb;color:white;padding:10px 16px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:600;font-size:14px;">
          Set a new password
        </a>
      </p>
      <p style="margin: 0 0 6px; font-size: 12px; color:#64748b;">
        If the button doesn’t work, copy and paste this URL:
      </p>
      <p style="margin: 0 0 14px; font-size: 12px; color:#0f172a; word-break: break-all;">
        ${safeUrl}
      </p>
      <p style="margin: 0; font-size: 12px; color:#64748b;">
        If you didn’t request this, you can safely ignore this email.
      </p>
    `
  );

  const text = [
    "Reset your password",
    "",
    "Use the link below to set a new password:",
    fixedUrl,
    "",
    "If you didn’t request this, ignore this email.",
  ].join("\n");

  await sendOrLog({ to, subject: "Reset your password", html, text });
}

/* -------------------- Receipt emails -------------------- */

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

  bookingId?: string;
  paymentType?: "CARD" | "CASH" | null;

  baseFareCents?: number | null;
  discountCents?: number | null;
  convenienceFeeCents?: number | null;
  finalTotalCents?: number | null;
};

function moneyLine(label: string, valueCents: number, negative = false) {
  const val = formatMoneyFromCents(valueCents);
  return `
    <div style="display:flex; justify-content:space-between; gap:10px; margin:4px 0; font-size:13px; color:#334155;">
      <div>${escapeHtml(label)}</div>
      <div style="font-weight:600;">${negative ? "-" : ""}$${escapeHtml(val)}</div>
    </div>
  `;
}

function receiptBreakdownHtml(ride: RideReceiptSnapshot) {
  const base = normalizeCents(ride.baseFareCents);
  const disc = normalizeCents(ride.discountCents);
  const fee = normalizeCents(ride.convenienceFeeCents);

  const total =
    normalizeCents(ride.finalTotalCents) ||
    normalizeCents(ride.totalPriceCents) ||
    Math.max(0, base + fee - disc);

  return `
    <div style="border-radius:14px; border:1px solid #e2e8f0; padding:14px; background:#ffffff;">
      ${moneyLine("Base fare", base)}
      ${moneyLine("Discount", disc, true)}
      ${moneyLine("Convenience fee", fee)}
      <div style="height:1px; background:#e2e8f0; margin:10px 0;"></div>
      <div style="display:flex; justify-content:space-between; gap:10px; font-size:14px; color:#0f172a;">
        <div style="font-weight:700;">Total</div>
        <div style="font-weight:800;">$${escapeHtml(formatMoneyFromCents(total))}</div>
      </div>
    </div>
  `;
}

function riderReceiptHtml(args: {
  riderName?: string | null;
  riderEmail?: string | null;
  driverName?: string | null;
  driverEmail?: string | null;
  ride: RideReceiptSnapshot;
}) {
  const { riderName, riderEmail, driverName, driverEmail, ride } = args;

  const totalCents = normalizeCents(ride.finalTotalCents ?? ride.totalPriceCents);
  const amount = formatMoneyFromCents(totalCents);
  const miles = formatMiles(ride.distanceMiles);

  const completedWhen = fmtDate(ride.tripCompletedAt ?? ride.departureTime);
  const started = fmtDate(ride.tripStartedAt);
  const completed = fmtDate(ride.tripCompletedAt);

  const payment = ride.paymentType ? escapeHtml(ride.paymentType) : "n/a";

  return `
    <p style="margin:0 0 18px; font-size:14px; color:#475569;">
      Here is your receipt for the completed trip${riderName ? `, ${escapeHtml(riderName)}` : ""}.
    </p>

    <div style="border-radius:14px; border:1px solid #e2e8f0; padding:16px; margin-bottom:14px; background:#ffffff;">
      <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:12px;">
        <div>
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#64748b; margin-bottom:4px;">Route</div>
          <div style="font-size:15px; font-weight:700; color:#0f172a;">
            ${escapeHtml(ride.originCity)} → ${escapeHtml(ride.destinationCity)}
          </div>
          <div style="font-size:12px; color:#64748b; margin-top:3px;">
            Completed • ${escapeHtml(completedWhen)}
          </div>
        </div>

        <div style="text-align:right;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#64748b; margin-bottom:4px;">Total</div>
          <div style="font-size:20px; font-weight:800; color:#0f172a;">$${escapeHtml(amount)}</div>
          <div style="font-size:11px; color:#94a3b8; margin-top:2px;">
            Stored as ${totalCents} cents
          </div>
        </div>
      </div>

      <div style="display:flex; flex-wrap:wrap; gap:16px; font-size:13px; color:#334155;">
        <div style="flex:1 1 140px;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Distance</div>
          <div style="margin-top:3px; font-weight:700;">${escapeHtml(miles)} miles</div>
        </div>
        <div style="flex:1 1 120px;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Passengers</div>
          <div style="margin-top:3px; font-weight:700;">${ride.passengerCount ?? "n/a"}</div>
        </div>
        <div style="flex:1 1 120px;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Payment</div>
          <div style="margin-top:3px; font-weight:700;">${payment}</div>
        </div>
      </div>
    </div>

    <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:14px;">
      <div style="flex:1 1 260px; border-radius:14px; border:1px solid #e2e8f0; padding:14px; background:#ffffff;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; margin-bottom:6px;">Rider</div>
        <div style="font-size:14px; font-weight:700; color:#0f172a;">${escapeHtml(riderName || "Rider")}</div>
        ${riderEmail ? `<div style="font-size:12px; color:#64748b; margin-top:2px;">${escapeHtml(riderEmail)}</div>` : ""}
      </div>

      <div style="flex:1 1 260px; border-radius:14px; border:1px solid #e2e8f0; padding:14px; background:#ffffff;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; margin-bottom:6px;">Driver</div>
        <div style="font-size:14px; font-weight:700; color:#0f172a;">${escapeHtml(driverName || "Driver")}</div>
        ${driverEmail ? `<div style="font-size:12px; color:#64748b; margin-top:2px;">${escapeHtml(driverEmail)}</div>` : ""}
      </div>
    </div>

    ${receiptBreakdownHtml(ride)}

    <div style="border-radius:14px; border:1px solid #e2e8f0; padding:16px; margin-top:14px; background:#ffffff;">
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; margin-bottom:6px;">Timing</div>
      <div style="display:flex; flex-wrap:wrap; gap:16px; font-size:13px; color:#334155;">
        <div style="flex:1 1 180px;">
          <div style="font-size:11px; color:#94a3b8;">Scheduled departure</div>
          <div style="margin-top:3px; font-weight:600;">${escapeHtml(fmtDate(ride.departureTime))}</div>
        </div>
        <div style="flex:1 1 180px;">
          <div style="font-size:11px; color:#94a3b8;">Trip started</div>
          <div style="margin-top:3px; font-weight:600;">${escapeHtml(started)}</div>
        </div>
        <div style="flex:1 1 180px;">
          <div style="font-size:11px; color:#94a3b8;">Trip completed</div>
          <div style="margin-top:3px; font-weight:600;">${escapeHtml(completed)}</div>
        </div>
      </div>
      <div style="margin-top:10px; font-size:11px; color:#94a3b8;">
        Ride ID: ${escapeHtml(ride.id)}${ride.bookingId ? ` • Booking ID: ${escapeHtml(ride.bookingId)}` : ""}
      </div>
    </div>

    <p style="margin:14px 0 0; font-size:12px; color:#94a3b8;">
      If you have questions about this trip, reply with the ride ID.
    </p>
  `;
}

function driverReceiptHtml(args: {
  driverName?: string | null;
  driverEmail?: string | null;
  riderName?: string | null;
  riderEmail?: string | null;
  ride: RideReceiptSnapshot;
}) {
  const { driverName, driverEmail, riderName, riderEmail, ride } = args;

  const totalCents = normalizeCents(ride.finalTotalCents ?? ride.totalPriceCents);
  const amount = formatMoneyFromCents(totalCents);
  const miles = formatMiles(ride.distanceMiles);
  const completedWhen = fmtDate(ride.tripCompletedAt ?? ride.departureTime);
  const payment = ride.paymentType ? escapeHtml(ride.paymentType) : "n/a";

  return `
    <p style="margin:0 0 18px; font-size:14px; color:#475569;">
      Ride receipt (Driver copy)${driverName ? `, ${escapeHtml(driverName)}` : ""}.
    </p>

    <div style="border-radius:14px; border:1px solid #e2e8f0; padding:16px; margin-bottom:14px; background:#ffffff;">
      <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:12px;">
        <div>
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#64748b; margin-bottom:4px;">Route</div>
          <div style="font-size:15px; font-weight:700; color:#0f172a;">
            ${escapeHtml(ride.originCity)} → ${escapeHtml(ride.destinationCity)}
          </div>
          <div style="font-size:12px; color:#64748b; margin-top:3px;">
            Completed • ${escapeHtml(completedWhen)}
          </div>
        </div>

        <div style="text-align:right;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#64748b; margin-bottom:4px;">Total</div>
          <div style="font-size:20px; font-weight:800; color:#0f172a;">$${escapeHtml(amount)}</div>
          <div style="font-size:11px; color:#94a3b8; margin-top:2px;">
            Stored as ${totalCents} cents
          </div>
        </div>
      </div>

      <div style="display:flex; flex-wrap:wrap; gap:16px; font-size:13px; color:#334155;">
        <div style="flex:1 1 140px;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Distance</div>
          <div style="margin-top:3px; font-weight:700;">${escapeHtml(miles)} miles</div>
        </div>
        <div style="flex:1 1 120px;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Passengers</div>
          <div style="margin-top:3px; font-weight:700;">${ride.passengerCount ?? "n/a"}</div>
        </div>
        <div style="flex:1 1 120px;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Payment</div>
          <div style="margin-top:3px; font-weight:700;">${payment}</div>
        </div>
      </div>
    </div>

    <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:14px;">
      <div style="flex:1 1 260px; border-radius:14px; border:1px solid #e2e8f0; padding:14px; background:#ffffff;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; margin-bottom:6px;">Rider</div>
        <div style="font-size:14px; font-weight:700; color:#0f172a;">${escapeHtml(riderName || "Rider")}</div>
        ${riderEmail ? `<div style="font-size:12px; color:#64748b; margin-top:2px;">${escapeHtml(riderEmail)}</div>` : ""}
      </div>

      <div style="flex:1 1 260px; border-radius:14px; border:1px solid #e2e8f0; padding:14px; background:#ffffff;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; margin-bottom:6px;">Driver</div>
        <div style="font-size:14px; font-weight:700; color:#0f172a;">${escapeHtml(driverName || "Driver")}</div>
        ${driverEmail ? `<div style="font-size:12px; color:#64748b; margin-top:2px;">${escapeHtml(driverEmail)}</div>` : ""}
      </div>
    </div>

    ${receiptBreakdownHtml(ride)}

    <div style="border-radius:14px; border:1px solid #e2e8f0; padding:16px; margin-top:14px; background:#ffffff;">
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; margin-bottom:6px;">Timing</div>
      <div style="display:flex; flex-wrap:wrap; gap:16px; font-size:13px; color:#334155;">
        <div style="flex:1 1 180px;">
          <div style="font-size:11px; color:#94a3b8;">Scheduled departure</div>
          <div style="margin-top:3px; font-weight:600;">${escapeHtml(fmtDate(ride.departureTime))}</div>
        </div>
        <div style="flex:1 1 180px;">
          <div style="font-size:11px; color:#94a3b8;">Trip started</div>
          <div style="margin-top:3px; font-weight:600;">${escapeHtml(fmtDate(ride.tripStartedAt))}</div>
        </div>
        <div style="flex:1 1 180px;">
          <div style="font-size:11px; color:#94a3b8;">Trip completed</div>
          <div style="margin-top:3px; font-weight:600;">${escapeHtml(fmtDate(ride.tripCompletedAt))}</div>
        </div>
      </div>
      <div style="margin-top:10px; font-size:11px; color:#94a3b8;">
        Ride ID: ${escapeHtml(ride.id)}${ride.bookingId ? ` • Booking ID: ${escapeHtml(ride.bookingId)}` : ""}
      </div>
    </div>

    <p style="margin:14px 0 0; font-size:12px; color:#94a3b8;">
      If you need help with this trip, reply with the ride ID.
    </p>
  `;
}

export async function sendRideReceiptEmail(args: {
  riderEmail: string;
  riderName?: string | null;
  riderEmailLabel?: string | null;
  driverName?: string | null;
  driverEmail?: string | null;
  ride: RideReceiptSnapshot;
}) {
  const subject = `Your ride receipt • ${args.ride.originCity} → ${args.ride.destinationCity}`;
  const html = wrapHtml(
    "Ride receipt",
    riderReceiptHtml({
      riderName: args.riderName ?? null,
      riderEmail: args.riderEmail ?? null,
      driverName: args.driverName ?? null,
      driverEmail: args.driverEmail ?? null,
      ride: args.ride,
    })
  );

  const text = [
    "Ride receipt",
    "",
    `Route: ${args.ride.originCity} -> ${args.ride.destinationCity}`,
    `Total: $${formatMoneyFromCents(args.ride.finalTotalCents ?? args.ride.totalPriceCents)}`,
    `Ride ID: ${args.ride.id}`,
  ].join("\n");

  await sendOrLog({ to: args.riderEmail, subject, html, text });
}

export async function sendDriverReceiptEmail(args: {
  driverEmail: string;
  driverName?: string | null;
  riderName?: string | null;
  riderEmail?: string | null;
  ride: RideReceiptSnapshot;
}) {
  const subject = `Driver receipt • ${args.ride.originCity} → ${args.ride.destinationCity}`;
  const html = wrapHtml(
    "Ride receipt (Driver copy)",
    driverReceiptHtml({
      driverName: args.driverName ?? null,
      driverEmail: args.driverEmail ?? null,
      riderName: args.riderName ?? null,
      riderEmail: args.riderEmail ?? null,
      ride: args.ride,
    })
  );

  const text = [
    "Driver receipt",
    "",
    `Route: ${args.ride.originCity} -> ${args.ride.destinationCity}`,
    `Total: $${formatMoneyFromCents(args.ride.finalTotalCents ?? args.ride.totalPriceCents)}`,
    `Ride ID: ${args.ride.id}`,
  ].join("\n");

  await sendOrLog({ to: args.driverEmail, subject, html, text });
}

/* ---------- Outstanding balance email ---------- */

export type OutstandingChargeEmailSnapshot = {
  id: string;
  totalCents: number;
  fareCents: number;
  convenienceFeeCents: number;
  currency: string; // "USD"
  reason: string;
  note?: string | null;
  createdAt: Date;
  ride: {
    id: string;
    originCity: string;
    destinationCity: string;
    departureTime: Date;
    tripCompletedAt: Date | null;
  };
};

function fmtMoney(cents: number) {
  const v = Number.isFinite(cents) ? Math.max(0, Math.round(cents)) : 0;
  return (v / 100).toFixed(2);
}

export async function sendOutstandingChargeEmailToRider(args: {
  riderEmail: string;
  riderName?: string | null;
  outstanding: OutstandingChargeEmailSnapshot;
  resolveUrl: string;
}) {
  const { riderEmail, riderName, outstanding, resolveUrl } = args;

  const title = "Action required: unpaid ride reported";
  const subject = "Action required: unpaid ride reported";

  const fixedResolveUrl = normalizeAppUrl(resolveUrl);
  const safeResolve = escapeHtml(fixedResolveUrl);

  const total = fmtMoney(outstanding.totalCents);
  const fare = fmtMoney(outstanding.fareCents);
  const fee = fmtMoney(outstanding.convenienceFeeCents);

  const ride = outstanding.ride;
  const routeLine = `${ride.originCity} → ${ride.destinationCity}`;
  const when = fmtDate(ride.tripCompletedAt ?? ride.departureTime);

  const reason = escapeHtml(outstanding.reason);
  const note = outstanding.note ? escapeHtml(outstanding.note) : "";

  const html = wrapHtml(
    title,
    `
      <p style="margin:0 0 12px; font-size:14px; color:#475569;">
        Hi${riderName ? ` ${escapeHtml(riderName)}` : ""}, a driver reported an unpaid CASH ride.
        Please review and respond.
      </p>

      <div style="border-radius:14px; border:1px solid #e2e8f0; padding:16px; background:#ffffff; margin-bottom:12px;">
        <div style="font-size:15px; font-weight:700; color:#0f172a; margin-bottom:6px;">
          ${escapeHtml(routeLine)}
        </div>
        <div style="font-size:12px; color:#64748b; margin-bottom:10px;">
          ${escapeHtml(when)}
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:13px; color:#334155;">
          <div style="flex:1 1 160px;">
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Fare</div>
            <div style="margin-top:3px; font-weight:600;">$${escapeHtml(fare)}</div>
          </div>
          <div style="flex:1 1 160px;">
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Convenience fee</div>
            <div style="margin-top:3px; font-weight:600;">$${escapeHtml(fee)}</div>
          </div>
          <div style="flex:1 1 160px;">
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Total due</div>
            <div style="margin-top:3px; font-weight:800; color:#0f172a;">$${escapeHtml(total)}</div>
          </div>
        </div>

        <div style="margin-top:12px; font-size:12px; color:#64748b;">
          Reason: <b style="color:#0f172a;">${reason}</b>
          ${note ? `<div style="margin-top:6px;">Note: <span style="color:#0f172a;">${note}</span></div>` : ""}
        </div>

        <div style="margin-top:14px;">
          <a href="${safeResolve}"
             style="background:#2563eb;color:white;padding:10px 16px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:700;font-size:14px;">
            Review & resolve
          </a>
        </div>

        <div style="margin-top:10px; font-size:12px; color:#94a3b8; word-break:break-all;">
          If the button doesn’t work, copy and paste this URL:<br/>
          ${safeResolve}
        </div>

        <div style="margin-top:10px; font-size:11px; color:#94a3b8;">
          Outstanding Charge ID: ${escapeHtml(outstanding.id)} • Ride ID: ${escapeHtml(ride.id)}
        </div>
      </div>

      <p style="margin:0; font-size:12px; color:#94a3b8;">
        If you believe this was reported in error, open the link above and choose “Dispute”.
      </p>
    `
  );

  const text = [
    "Action required: unpaid ride reported",
    "",
    `Route: ${ride.originCity} -> ${ride.destinationCity}`,
    `When: ${when}`,
    `Fare: $${fare}`,
    `Convenience fee: $${fee}`,
    `Total due: $${total}`,
    `Reason: ${outstanding.reason}`,
    outstanding.note ? `Note: ${outstanding.note}` : "",
    "",
    `Review & resolve: ${fixedResolveUrl}`,
    "",
    `Outstanding Charge ID: ${outstanding.id}`,
    `Ride ID: ${ride.id}`,
  ]
    .filter(Boolean)
    .join("\n");

  await sendOrLog({ to: riderEmail, subject, html, text });
}