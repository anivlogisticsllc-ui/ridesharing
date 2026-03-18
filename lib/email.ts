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

const PLATFORM_FEE_BPS = 1000; // 10%

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

  originalPaymentType?: "CARD" | "CASH" | null;
  fallbackCardChargedAt?: Date | null;
  cashNotPaidAt?: Date | null;
  cashDiscountRevokedAt?: Date | null;
  cashNotPaidReason?: string | null;
  cashNotPaidNote?: string | null;

  refundIssued?: boolean;
  refundAmountCents?: number | null;
  refundIssuedAt?: Date | null;
  disputeResolvedAt?: Date | null;
};

function computeDriverSplitForEmail(grossAmountCents: number) {
  const gross = normalizeCents(grossAmountCents);
  const fee = Math.round(gross * (PLATFORM_FEE_BPS / 10000));
  const net = Math.max(0, gross - fee);

  return {
    grossAmountCents: gross,
    serviceFeeCents: fee,
    netAmountCents: net,
  };
}

function moneyLine(label: string, valueCents: number, negative = false) {
  const val = formatMoneyFromCents(valueCents);
  return `
    <div style="display:flex; justify-content:space-between; gap:10px; margin:4px 0; font-size:13px; color:#334155;">
      <div>${escapeHtml(label)}</div>
      <div style="font-weight:600;">${negative ? "-" : ""}$${escapeHtml(val)}</div>
    </div>
  `;
}

function getReceiptMoney(ride: RideReceiptSnapshot) {
  const base = normalizeCents(ride.baseFareCents);
  const disc = normalizeCents(ride.discountCents);
  const fee = normalizeCents(ride.convenienceFeeCents);

  const originalTotal =
    normalizeCents(ride.finalTotalCents) ||
    normalizeCents(ride.totalPriceCents) ||
    Math.max(0, base + fee - disc);

  const refundAmountCents = Math.min(
    normalizeCents(ride.refundAmountCents),
    originalTotal
  );

  const refundedAfterDispute = Boolean(ride.refundIssued && refundAmountCents > 0);
  const netCardResultCents = Math.max(0, originalTotal - refundAmountCents);

  return {
    base,
    disc,
    fee,
    originalTotal,
    refundAmountCents,
    refundedAfterDispute,
    netCardResultCents,
  };
}

function getPaymentLabelForReceipt(ride: RideReceiptSnapshot) {
  const originallyCash = ride.originalPaymentType === "CASH";
  const fallbackCharged = Boolean(ride.cashNotPaidAt && ride.fallbackCardChargedAt);
  const switchedToCardFallback =
    originallyCash && ride.paymentType === "CARD" && fallbackCharged;

  const refundAmountCents = normalizeCents(ride.refundAmountCents);
  const refundedAfterDispute = Boolean(ride.refundIssued && refundAmountCents > 0);

  if (switchedToCardFallback && refundedAfterDispute) {
    return "CARD (fallback after unpaid CASH, later refunded)";
  }
  if (switchedToCardFallback) {
    return "CARD (fallback after unpaid CASH)";
  }
  if (ride.paymentType === "CARD") return "CARD";
  if (ride.paymentType === "CASH") return "CASH";
  return "n/a";
}

function receiptBreakdownHtml(ride: RideReceiptSnapshot) {
  const { base, disc, fee, originalTotal } = getReceiptMoney(ride);

  return `
    <div style="border-radius:14px; border:1px solid #e2e8f0; padding:14px; background:#ffffff;">
      ${moneyLine("Base fare", base)}
      ${moneyLine("Discount", disc, true)}
      ${moneyLine("Convenience fee", fee)}
      <div style="height:1px; background:#e2e8f0; margin:10px 0;"></div>
      <div style="display:flex; justify-content:space-between; gap:10px; font-size:14px; color:#0f172a;">
        <div style="font-weight:700;">Original total</div>
        <div style="font-weight:800;">$${escapeHtml(formatMoneyFromCents(originalTotal))}</div>
      </div>
    </div>
  `;
}

function fallbackChargeHtml(ride: RideReceiptSnapshot) {
  const originallyCash = ride.originalPaymentType === "CASH";
  const fallbackCharged = Boolean(ride.cashNotPaidAt && ride.fallbackCardChargedAt);
  const switchedToCardFallback =
    originallyCash && ride.paymentType === "CARD" && fallbackCharged;

  if (!switchedToCardFallback) return "";

  const originalTotal = getReceiptMoney(ride).originalTotal;

  return `
    <div style="border-radius:14px; border:1px solid #fcd34d; padding:14px; margin-top:14px; background:#fffbeb;">
      <div style="font-size:14px; font-weight:700; color:#92400e; margin-bottom:8px;">
        Cash fallback charge
      </div>

      <div style="font-size:12px; color:#78350f; line-height:1.7;">
        <div>Original payment selection: <b>CASH</b></div>
        <div>Fallback card charged amount: <b>$${escapeHtml(formatMoneyFromCents(originalTotal))}</b></div>
        <div>Cash not paid at: <b>${escapeHtml(fmtDate(ride.cashNotPaidAt))}</b></div>
        <div>Cash discount revoked at: <b>${escapeHtml(fmtDate(ride.cashDiscountRevokedAt))}</b></div>
        <div>Fallback card charged at: <b>${escapeHtml(fmtDate(ride.fallbackCardChargedAt))}</b></div>
        <div>Reason: <b>${escapeHtml(ride.cashNotPaidReason || "n/a")}</b></div>
        ${
          ride.cashNotPaidNote
            ? `<div>Note: <b>${escapeHtml(ride.cashNotPaidNote)}</b></div>`
            : ""
        }
      </div>
    </div>
  `;
}

function refundAfterDisputeHtml(ride: RideReceiptSnapshot, includeDriverPayoutEffect: boolean) {
  const {
    originalTotal,
    refundAmountCents,
    refundedAfterDispute,
    netCardResultCents,
  } = getReceiptMoney(ride);

  if (!refundedAfterDispute) return "";

  const originalDriverSplit = computeDriverSplitForEmail(originalTotal);
  const adjustedDriverSplit = computeDriverSplitForEmail(originalTotal);

  return `
    <div style="border-radius:14px; border:1px solid #86efac; padding:14px; margin-top:14px; background:#ecfdf5;">
      <div style="font-size:14px; font-weight:700; color:#166534; margin-bottom:8px;">
        Refund after dispute
      </div>

      <div style="font-size:12px; color:#166534; line-height:1.7;">
        <div>Refund recorded: <b>Yes</b></div>
        <div>Refund amount: <b>-$${escapeHtml(formatMoneyFromCents(refundAmountCents))}</b></div>
        <div>Refund issued at: <b>${escapeHtml(fmtDate(ride.refundIssuedAt))}</b></div>
        <div>Dispute resolved at: <b>${escapeHtml(fmtDate(ride.disputeResolvedAt))}</b></div>
      </div>

      <div style="border-radius:10px; border:1px solid #bbf7d0; background:#ffffffcc; padding:12px; margin-top:10px;">
        <div style="display:flex; justify-content:space-between; gap:10px; font-size:13px; color:#14532d;">
          <div>Original fallback charge</div>
          <div style="font-weight:700;">$${escapeHtml(formatMoneyFromCents(originalTotal))}</div>
        </div>
        <div style="display:flex; justify-content:space-between; gap:10px; font-size:13px; color:#14532d; margin-top:6px;">
          <div>Refund after dispute</div>
          <div style="font-weight:700;">-$${escapeHtml(formatMoneyFromCents(refundAmountCents))}</div>
        </div>
        <div style="height:1px; background:#bbf7d0; margin:10px 0;"></div>
        <div style="display:flex; justify-content:space-between; gap:10px; font-size:14px; color:#14532d;">
          <div style="font-weight:800;">Net card result</div>
          <div style="font-weight:800;">$${escapeHtml(formatMoneyFromCents(netCardResultCents))}</div>
        </div>
      </div>

      ${
        includeDriverPayoutEffect
          ? `
            <div style="border-radius:10px; border:1px solid #bbf7d0; background:#ffffffcc; padding:12px; margin-top:10px;">
              <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#15803d; margin-bottom:8px;">
                Driver payout effect
              </div>
              <div style="display:flex; justify-content:space-between; gap:10px; font-size:13px; color:#14532d;">
                <div>Driver gross fare</div>
                <div style="font-weight:700;">$${escapeHtml(formatMoneyFromCents(originalDriverSplit.grossAmountCents))}</div>
              </div>
              <div style="display:flex; justify-content:space-between; gap:10px; font-size:13px; color:#14532d; margin-top:6px;">
                <div>Platform fee</div>
                <div style="font-weight:700;">$${escapeHtml(formatMoneyFromCents(originalDriverSplit.serviceFeeCents))}</div>
              </div>
              <div style="height:1px; background:#bbf7d0; margin:10px 0;"></div>
              <div style="display:flex; justify-content:space-between; gap:10px; font-size:14px; color:#14532d;">
                <div style="font-weight:800;">Driver net after fee</div>
                <div style="font-weight:800;">$${escapeHtml(formatMoneyFromCents(adjustedDriverSplit.netAmountCents))}</div>
              </div>
            </div>
          `
          : ""
      }
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

  const { originalTotal, refundedAfterDispute } = getReceiptMoney(ride);
  const amount = formatMoneyFromCents(originalTotal);
  const miles = formatMiles(ride.distanceMiles);

  const completedWhen = fmtDate(ride.tripCompletedAt ?? ride.departureTime);
  const started = fmtDate(ride.tripStartedAt);
  const completed = fmtDate(ride.tripCompletedAt);

  const payment = getPaymentLabelForReceipt(ride);

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
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#64748b; margin-bottom:4px;">
            ${refundedAfterDispute ? "Original total" : "Total"}
          </div>
          <div style="font-size:20px; font-weight:800; color:#0f172a;">$${escapeHtml(amount)}</div>
          <div style="font-size:11px; color:#94a3b8; margin-top:2px;">
            Stored as ${originalTotal} cents
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
        <div style="flex:1 1 160px;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Payment</div>
          <div style="margin-top:3px; font-weight:700;">${escapeHtml(payment)}</div>
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
    ${fallbackChargeHtml(ride)}
    ${refundAfterDisputeHtml(ride, false)}

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

  const { originalTotal, refundedAfterDispute } = getReceiptMoney(ride);
  const amount = formatMoneyFromCents(originalTotal);
  const miles = formatMiles(ride.distanceMiles);
  const completedWhen = fmtDate(ride.tripCompletedAt ?? ride.departureTime);
  const payment = getPaymentLabelForReceipt(ride);

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
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#64748b; margin-bottom:4px;">
            ${refundedAfterDispute ? "Original total" : "Total"}
          </div>
          <div style="font-size:20px; font-weight:800; color:#0f172a;">$${escapeHtml(amount)}</div>
          <div style="font-size:11px; color:#94a3b8; margin-top:2px;">
            Stored as ${originalTotal} cents
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
        <div style="flex:1 1 160px;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8;">Payment</div>
          <div style="margin-top:3px; font-weight:700;">${escapeHtml(payment)}</div>
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
    ${fallbackChargeHtml(ride)}
    ${refundAfterDisputeHtml(ride, true)}

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

  const { originalTotal, refundAmountCents, refundedAfterDispute, netCardResultCents } = getReceiptMoney(args.ride);

  const text = [
    "Ride receipt",
    "",
    `Route: ${args.ride.originCity} -> ${args.ride.destinationCity}`,
    `Original total: $${formatMoneyFromCents(originalTotal)}`,
    refundedAfterDispute ? `Refund after dispute: -$${formatMoneyFromCents(refundAmountCents)}` : "",
    refundedAfterDispute ? `Net card result: $${formatMoneyFromCents(netCardResultCents)}` : "",
    `Ride ID: ${args.ride.id}`,
  ]
    .filter(Boolean)
    .join("\n");

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

  const {
    originalTotal,
    refundAmountCents,
    refundedAfterDispute,
    netCardResultCents,
  } = getReceiptMoney(args.ride);

  const driverSplit = computeDriverSplitForEmail(originalTotal);

  const text = [
    "Driver receipt",
    "",
    `Route: ${args.ride.originCity} -> ${args.ride.destinationCity}`,
    `Original total: $${formatMoneyFromCents(originalTotal)}`,
    refundedAfterDispute ? `Refund after dispute: -$${formatMoneyFromCents(refundAmountCents)}` : "",
    refundedAfterDispute ? `Net card result: $${formatMoneyFromCents(netCardResultCents)}` : "",
    `Platform fee: $${formatMoneyFromCents(driverSplit.serviceFeeCents)}`,
    `Driver net after fee: $${formatMoneyFromCents(driverSplit.netAmountCents)}`,
    `Ride ID: ${args.ride.id}`,
  ]
    .filter(Boolean)
    .join("\n");

  await sendOrLog({ to: args.driverEmail, subject, html, text });
}
