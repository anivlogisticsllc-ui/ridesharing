// app/billing/membership/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MembershipBadge from "@/components/MembershipBadge";
import { computeMembershipState, formatDate } from "@/lib/membership";
import { daysUntil } from "@/lib/dateUtils";
import { formatUsdFromCents, formatCardLabel } from "@/lib/money";

/* ---------- Types ---------- */

type UserSummary = {
  id: string;
  name: string | null;
  email: string;
  role: "RIDER" | "DRIVER";
  onboardingCompleted: boolean;
};

type BillingInfo = {
  currency: "USD";
  priceCentsPerMonth: number;
  hasPaymentMethod: boolean;
  defaultPaymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
};

type MembershipStatus = "ACTIVE" | "EXPIRED" | "TRIAL" | "CANCELLED" | "NONE";

type MembershipSummary = {
  plan: string | null;
  kind?: "TRIAL" | "PAID" | "NONE";
  active: boolean;
  status?: MembershipStatus | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

type MembershipApiResponse =
  | { ok: true; user: UserSummary; membership: MembershipSummary; billing: BillingInfo }
  | { ok: false; error: string };

type ActivateMembershipResponse =
  | {
      ok: true;
      membership: {
        id: string;
        type: string;
        plan: string;
        status: string;
        startDate: string;
        expiryDate: string;
        amountPaidCents: number;
      };
      charge: {
        id: string;
        amountCents: number;
        currency: string;
        status: string;
        paidAt: string | null;
        stripePaymentIntentId: string | null;
        stripeChargeId: string | null;
      };
    }
  | { ok: false; error: string };

/* ---------- Helpers ---------- */

function getProfileHref(user: { role: "RIDER" | "DRIVER" }) {
  return user.role === "RIDER" ? "/rider/profile" : "/driver/profile";
}

function LabelRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
      <div style={{ minWidth: 140, fontWeight: 700 }}>{label}</div>
      <div style={{ color: "#111827" }}>{value}</div>
    </div>
  );
}

function normalizeStatus(s: unknown): MembershipStatus | null {
  if (s === "ACTIVE" || s === "EXPIRED" || s === "TRIAL" || s === "CANCELLED" || s === "NONE") {
    return s;
  }
  return null;
}

async function readApiError(res: Response) {
  const text = await res.text().catch(() => "");
  if (!text) return `Request failed (HTTP ${res.status}).`;

  try {
    const json = JSON.parse(text);
    return json?.error || json?.message || `Request failed (HTTP ${res.status}).`;
  } catch {
    return text.slice(0, 300) || `Request failed (HTTP ${res.status}).`;
  }
}

/* ---------- Page ---------- */

export default function MembershipPage() {
  const router = useRouter();

  const [data, setData] = useState<MembershipApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  async function load() {
    setLoading(true);

    try {
      const res = await fetch("/api/billing/membership", { cache: "no-store" });

      if (res.status === 401) {
        router.replace("/auth/login?callbackUrl=/billing/membership");
        return;
      }

      const json = (await res.json().catch(() => null)) as MembershipApiResponse | null;
      if (!json) {
        setData({ ok: false, error: "Invalid server response." });
        return;
      }

      if (json.ok) {
        json.membership.status = normalizeStatus(json.membership.status);
      }

      setData(json);
    } catch (e: any) {
      setData({ ok: false, error: e?.message || "Failed to load membership." });
    } finally {
      setLoading(false);
    }
  }

  async function activateMembership() {
    setActionError(null);
    setActionSuccess(null);
    setActivating(true);

    try {
      const res = await fetch("/api/billing/membership/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(await readApiError(res));
      }

      const json = (await res.json().catch(() => null)) as ActivateMembershipResponse | null;
      if (!json || !json.ok) {
        throw new Error(json?.error || "Membership activation failed.");
      }

      setActionSuccess(
        `Membership activated successfully. Charged ${formatUsdFromCents(
          json.charge.amountCents
        )}.`
      );

      await load();
      router.refresh();
    } catch (e: any) {
      setActionError(e?.message || "Could not activate membership.");
    } finally {
      setActivating(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const ui = useMemo(() => {
    if (!data || data.ok === false) return null;

    const { user, membership: rawMembership, billing } = data;

    const membership: MembershipSummary = {
      ...rawMembership,
      status: normalizeStatus(rawMembership.status),
    };

    const { state, label, endsAtLabel } = computeMembershipState(membership as any);

    const plan = membership.plan ?? "STANDARD";
    const profileHref = getProfileHref(user);

    const trialEndLabel = endsAtLabel ?? formatDate(membership.trialEndsAt) ?? "—";
    const periodEndLabel = formatDate(membership.currentPeriodEnd) ?? "—";

    const trialDaysLeft = daysUntil(membership.trialEndsAt);
    const priceAfterTrial = formatUsdFromCents(billing.priceCentsPerMonth);

    const statusLine = (() => {
      if (state === "TRIAL") {
        if (typeof trialDaysLeft === "number") {
          return trialDaysLeft === 1
            ? `Trial ends in 1 day (${trialEndLabel})`
            : `Trial ends in ${trialDaysLeft} days (${trialEndLabel})`;
        }
        return `Trial until ${trialEndLabel}`;
      }

      if (state === "ACTIVE") return `Active (renews ${periodEndLabel})`;
      if (state === "EXPIRED") return `Expired (${periodEndLabel})`;
      if (state === "NONE") return "No membership yet";
      return label;
    })();

    const paymentMethodLine = billing.hasPaymentMethod
      ? billing.defaultPaymentMethod
        ? formatCardLabel(billing.defaultPaymentMethod)
        : "Card on file"
      : "No card on file";

    const helpLine = (() => {
      if (state === "ACTIVE") return "Your membership is active.";
      if (state === "TRIAL") {
        return "During trial, CASH requests require a backup card on file. After trial ends, you’ll need a paid membership to continue.";
      }
      if (state === "EXPIRED") {
        return "Your trial ended. Activate a paid membership to continue requesting rides.";
      }
      return "Activate a membership to access member-only features.";
    })();

    const showActivate = state === "EXPIRED" || state === "NONE" || state === "TRIAL";

    return {
      user,
      membership,
      billing,
      plan,
      profileHref,
      state,
      statusLine,
      priceAfterTrial,
      paymentMethodLine,
      helpLine,
      showActivate,
    };
  }, [data]);

  if (loading) {
    return (
      <main style={pageStyle}>
        <Card>
          <h1 style={h1}>Membership</h1>
          <p style={muted}>Loading…</p>
        </Card>
      </main>
    );
  }

  if (!data || data.ok === false) {
    const errMsg = data?.ok === false ? data.error : "Could not load membership.";

    return (
      <main style={pageStyle}>
        <Card>
          <h1 style={h1}>Membership</h1>
          <p style={{ color: "#b91c1c", marginTop: 12 }}>{String(errMsg)}</p>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/" style={linkBtn}>
              Back to home
            </Link>
            <button type="button" style={linkBtn} onClick={() => void load()}>
              Reload
            </button>
          </div>
        </Card>
      </main>
    );
  }

  if (!ui) return null;

  const activateLabel =
    ui.state === "TRIAL" ? "Activate paid membership" : "Activate membership";

  return (
    <main style={pageStyle}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <h1 style={h1}>{ui.user.role === "DRIVER" ? "Driver membership" : "Rider membership"}</h1>
            <p style={muted}>After your free trial, membership is {ui.priceAfterTrial}/month.</p>
          </div>
          <MembershipBadge membership={ui.membership as any} />
        </div>

        <div style={{ marginTop: 16, display: "grid", gap: 10, fontSize: 14 }}>
          <LabelRow label="Account" value={ui.user.name || ui.user.email} />
          <LabelRow label="Status" value={ui.statusLine} />
          <LabelRow label="Plan" value={ui.plan} />
          <LabelRow label="Monthly price" value={ui.priceAfterTrial} />
          <LabelRow label="Payment method" value={ui.paymentMethodLine} />

          <p style={{ ...muted, marginTop: 6 }}>{ui.helpLine}</p>

          {ui.membership.cancelAtPeriodEnd ? (
            <p style={{ ...muted, marginTop: 0 }}>
              Your membership is set to cancel at the end of the current period.
            </p>
          ) : null}

          {actionSuccess ? (
            <div
              style={{
                marginTop: 8,
                border: "1px solid #bbf7d0",
                background: "#f0fdf4",
                color: "#166534",
                padding: 12,
                borderRadius: 10,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13 }}>Success</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{actionSuccess}</div>
            </div>
          ) : null}

          {actionError ? (
            <div
              style={{
                marginTop: 8,
                border: "1px solid #fecaca",
                background: "#fef2f2",
                color: "#b91c1c",
                padding: 12,
                borderRadius: 10,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13 }}>Action failed</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{actionError}</div>
            </div>
          ) : null}

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/account/billing" style={linkBtn}>
              Manage billing
            </Link>

            <Link href="/account/billing/payment-method" style={linkBtn}>
              Manage cards
            </Link>

            {ui.showActivate ? (
              <button
                type="button"
                onClick={activateMembership}
                disabled={activating}
                style={{
                  ...linkBtn,
                  cursor: activating ? "not-allowed" : "pointer",
                  opacity: activating ? 0.7 : 1,
                }}
              >
                {activating ? "Starting…" : activateLabel}
              </button>
            ) : null}

            <Link href={ui.profileHref} style={linkBtn}>
              Profile
            </Link>

            <Link href="/" style={linkBtn}>
              Home
            </Link>
          </div>
        </div>
      </Card>
    </main>
  );
}

/* ---------- UI bits ---------- */

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 24,
        maxWidth: 640,
        width: "100%",
        background: "#fff",
      }}
    >
      {children}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "calc(100vh - 56px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "system-ui, sans-serif",
  padding: 16,
  background: "#fafafa",
};

const h1: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  margin: 0,
};

const muted: React.CSSProperties = {
  fontSize: 14,
  color: "#4b5563",
  marginTop: 8,
  lineHeight: 1.5,
};

const linkBtn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  textDecoration: "none",
  fontSize: 14,
  fontWeight: 600,
};