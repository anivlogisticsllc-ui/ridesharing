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

type MembershipSummary = {
  plan: string | null;
  kind?: "TRIAL" | "PAID" | "NONE";
  active: boolean;
  status?: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

type MembershipApiResponse =
  | { ok: true; user: UserSummary; membership: MembershipSummary; billing: BillingInfo }
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

/* ---------- Page ---------- */

export default function MembershipPage() {
  const router = useRouter();

  const [data, setData] = useState<MembershipApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [activating, setActivating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

      setData(json);
    } catch (e: any) {
      setData({ ok: false, error: e?.message || "Failed to load membership." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleActivateTrial() {
    try {
      setActionError(null);
      setActivating(true);

      const res = await fetch("/api/billing/membership/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "STANDARD", days: 30 }),
      });

      const json = await res.json().catch(() => null);

      if (res.status === 401) {
        router.replace("/auth/login?callbackUrl=/billing/membership");
        return;
      }

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to start trial.");
      }

      await load();
    } catch (e: any) {
      setActionError(e?.message || "Trial activation failed.");
    } finally {
      setActivating(false);
    }
  }

  const ui = useMemo(() => {
    if (!data || data.ok === false) return null;

    const { user, membership, billing } = data;
    const { state, label, endsAtLabel } = computeMembershipState(membership);

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

    const canStartTrial = !activating && (state === "NONE" || state === "EXPIRED");

    const paymentMethodLine = billing.hasPaymentMethod
      ? billing.defaultPaymentMethod
        ? formatCardLabel(billing.defaultPaymentMethod)
        : "Card on file"
      : "No card on file";

    return {
      user,
      membership,
      billing,
      plan,
      profileHref,
      state,
      canStartTrial,
      statusLine,
      priceAfterTrial,
      trialEndLabel,
      paymentMethodLine,
    };
  }, [data, activating]);

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
            <button type="button" style={linkBtn} onClick={() => load()}>
              Reload
            </button>
          </div>
        </Card>
      </main>
    );
  }

  if (!ui) return null;

  return (
    <main style={pageStyle}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h1 style={h1}>{ui.user.role === "DRIVER" ? "Driver membership" : "Rider membership"}</h1>
            <p style={muted}>
              After your free trial, membership is {ui.priceAfterTrial}/month.
            </p>
          </div>
          <MembershipBadge membership={ui.membership as any} />
        </div>

        <div style={{ marginTop: 16, display: "grid", gap: 10, fontSize: 14 }}>
          <LabelRow label="Account" value={ui.user.name || ui.user.email} />
          <LabelRow label="Status" value={ui.statusLine} />
          <LabelRow label="Plan" value={ui.plan} />
          <LabelRow label="Monthly price" value={ui.priceAfterTrial} />
          <LabelRow label="Payment method" value={ui.paymentMethodLine} />

          {ui.membership.cancelAtPeriodEnd ? (
            <p style={{ ...muted, marginTop: 6 }}>
              Your membership is set to cancel at the end of the current period.
            </p>
          ) : null}

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleActivateTrial}
              disabled={!ui.canStartTrial}
              style={!ui.canStartTrial ? disabledBtn : primaryBtn}
              title={ui.canStartTrial ? "Start a 30-day trial" : "Membership already active"}
            >
              {activating ? "Starting…" : ui.canStartTrial ? "Start free 30-day trial" : "Membership active"}
            </button>

            <Link href="/account/billing" style={linkBtn}>
              Manage billing
            </Link>

            <Link href={ui.profileHref} style={linkBtn}>
              Profile
            </Link>

            <Link href="/" style={linkBtn}>
              Home
            </Link>
          </div>

          {actionError ? (
            <p style={{ marginTop: 10, color: "#b91c1c", fontSize: 14 }}>{actionError}</p>
          ) : null}

          {ui.state === "TRIAL" ? (
            <p style={{ ...muted, marginTop: 8 }}>
              When the trial ends, you’ll need an active paid membership to continue using member-only features.
            </p>
          ) : null}
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
        maxWidth: 600,
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

const disabledBtn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#f3f4f6",
  color: "#6b7280",
  cursor: "not-allowed",
  fontSize: 14,
  fontWeight: 600,
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

const primaryBtn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #111827",
  background: "#111827",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
};
