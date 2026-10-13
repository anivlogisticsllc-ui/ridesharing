// app/admin/users/[id]/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession } from "next-auth/react";

type Role = "RIDER" | "DRIVER" | "ADMIN";

type DriverProfile = {
  id?: string;
  verificationStatus?: string | null;
  plateNumber?: string | null;
  plateState?: string | null;
  vehicleColor?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: number | null;

  driverLicenseNumber?: string | null;
  driverLicenseState?: string | null;
  driverLicenseExpiry?: string | null;

  createdAt?: string | null;
  updatedAt?: string | null;
};

type ComputedMembership = {
  source: "membership_table" | "legacy_user_fields";
  membershipId: string | null;
  type: string | null;
  plan: string | null;
  status: "TRIAL" | "ACTIVE" | "EXPIRED" | "INACTIVE";
  active: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  amountPaidCents: number | null;
  paymentProvider: string | null;
  paymentRef: string | null;
};


type AdminPaymentMethod = {
  id: string;
  provider?: string | null;
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
  isDefault?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type AdminMembershipCharge = {
  id: string;
  amountCents?: number | null;
  currency?: string | null;
  status?: string | null;
  failureReason?: string | null;
  provider?: string | null;
  providerRef?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type UserDetails = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  phone: string | null;
  bio: string | null;
  photoUrl: string | null;

  accountStatus: string | null;
  isAdmin: boolean;

  emailVerified: boolean | null;

  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;

  onboardingCompleted: boolean;
  onboardingStep: number | null;

  publicId: string | null;

  membershipActive: boolean;
  membershipPlan: string | null;
  trialEndsAt: string | null;
  freeMembershipEndsAt: string | null;

  computedMembership?: ComputedMembership | null;

  createdAt: string | null;
  updatedAt: string | null;

  driverProfile: DriverProfile | null;

  paymentMethods?: AdminPaymentMethod[];
  membershipCharges?: AdminMembershipCharge[];
};

type ApiOk = { ok: true; user: UserDetails };
type ApiErr = { ok: false; error: string };

const MEMBERSHIP_PLANS = ["STANDARD"] as const;

function asRole(v: unknown): Role | null {
  return v === "RIDER" || v === "DRIVER" || v === "ADMIN" ? v : null;
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function inputClass() {
  return "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
}

function fmt(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function toNumberOrNull(v: string) {
  const t = v.trim();
  if (!t) return null;

  const n = Number(t);
  if (!Number.isFinite(n)) return null;

  return Math.trunc(n);
}

function isoToLocalInput(iso: string | null) {
  if (!iso) return "";

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const pad = (n: number) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string) {
  const t = local.trim();
  if (!t) return null;

  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;

  return d.toISOString();
}

function formatIsoShort(iso: string | null) {
  if (!iso) return "—";

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleString();
}

function computeMembershipView(user: UserDetails) {
  const cm = user.computedMembership ?? null;

  if (cm?.source === "membership_table") {
    const isPaid = (cm.amountPaidCents ?? 0) > 0;

    if (cm.status === "ACTIVE") {
      return {
        badge: isPaid ? "PAID" : "TRIAL",
        summary: isPaid
          ? `Paid membership active until ${formatIsoShort(cm.currentPeriodEnd)}`
          : `Trial active until ${formatIsoShort(cm.trialEndsAt || cm.currentPeriodEnd)}`,
        source: "Membership table",
        plan: cm.plan ?? user.membershipPlan,
      };
    }

    if (cm.status === "TRIAL") {
      return {
        badge: "TRIAL",
        summary: `Trial ends ${formatIsoShort(cm.trialEndsAt || cm.currentPeriodEnd)}`,
        source: "Membership table",
        plan: cm.plan ?? user.membershipPlan,
      };
    }

    if (cm.status === "EXPIRED") {
      return {
        badge: "EXPIRED",
        summary: `Latest membership expired ${
          cm.currentPeriodEnd ? `on ${formatIsoShort(cm.currentPeriodEnd)}` : ""
        }`.trim(),
        source: "Membership table",
        plan: cm.plan ?? user.membershipPlan,
      };
    }

    return {
      badge: "INACTIVE",
      summary: "No active paid membership, trial, or admin grant.",
      source: "Membership table",
      plan: cm.plan ?? user.membershipPlan,
    };
  }

  const now = Date.now();

  const trialEndsAtMs = user.trialEndsAt ? Date.parse(user.trialEndsAt) : NaN;
  const grantEndsAtMs = user.freeMembershipEndsAt ? Date.parse(user.freeMembershipEndsAt) : NaN;

  const hasTrial = Number.isFinite(trialEndsAtMs) && trialEndsAtMs > now;
  const hasGrant = Number.isFinite(grantEndsAtMs) && grantEndsAtMs > now;

  if (hasTrial) {
    return {
      badge: "TRIAL",
      summary: `Trial ends ${formatIsoShort(user.trialEndsAt)}`,
      source: "trialEndsAt",
      plan: user.membershipPlan,
    };
  }

  if (hasGrant) {
    return {
      badge: "ADMIN GRANT",
      summary: `Grant ends ${formatIsoShort(user.freeMembershipEndsAt)}`,
      source: "freeMembershipEndsAt",
      plan: user.membershipPlan,
    };
  }

  if (user.membershipActive) {
    return {
      badge: "ACTIVE",
      summary: `Active${user.membershipPlan ? ` • plan ${user.membershipPlan}` : ""}`,
      source: "membershipActive",
      plan: user.membershipPlan,
    };
  }

  return {
    badge: "INACTIVE",
    summary: "No active trial, grant, or paid membership indicated by current admin fields.",
    source: "none",
    plan: user.membershipPlan,
  };
}

function MembershipBadge({ value }: { value: string }) {
  const cls =
    value === "TRIAL"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : value === "ADMIN GRANT"
      ? "border-sky-200 bg-sky-50 text-sky-700"
      : value === "ACTIVE" || value === "PAID"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : value === "EXPIRED"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}
    >
      {value}
    </span>
  );
}

function formatMoneyCents(amountCents?: number | null, currency?: string | null) {
  if (amountCents === null || amountCents === undefined || !Number.isFinite(amountCents)) {
    return "—";
  }

  const code = (currency || "USD").toUpperCase();

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${code}`;
  }
}

function formatCardBrand(brand?: string | null) {
  const value = (brand || "").trim();
  if (!value) return "Card";

  return value
    .split(/[\s_-]+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(" ");
}

function formatCardExpiry(expMonth?: number | null, expYear?: number | null) {
  if (!expMonth || !expYear) return "—";

  const mm = String(expMonth).padStart(2, "0");
  const yyyy = String(expYear);

  return `${mm}/${yyyy}`;
}

function StatusBadge({ value }: { value?: string | null }) {
  const normalized = (value || "UNKNOWN").toUpperCase();

  const cls =
    normalized === "SUCCEEDED" || normalized === "PAID" || normalized === "ACTIVE"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : normalized === "FAILED" || normalized === "CANCELED" || normalized === "EXPIRED"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : normalized === "PENDING" || normalized === "PROCESSING"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>
      {normalized}
    </span>
  );
}

export default function AdminUserDetailsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");

  const { data: session, status } = useSession();
  const role = asRole((session?.user as any)?.role);

  const callbackUrl = useMemo(
    () => encodeURIComponent(`/admin/users/${encodeURIComponent(id)}`),
    [id]
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState<UserDetails | null>(null);
  const [draft, setDraft] = useState<UserDetails | null>(null);

  const [grantDays, setGrantDays] = useState<string>("");

  const [resettingPassword, setResettingPassword] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const [tempPassword, setTempPassword] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);

  function set<K extends keyof UserDetails>(key: K, value: UserDetails[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function setDriver<K extends keyof DriverProfile>(key: K, value: DriverProfile[K]) {
    setDraft((prev) => {
      if (!prev) return prev;

      const dp = prev.driverProfile ? { ...prev.driverProfile } : {};
      (dp as any)[key] = value;

      return { ...prev, driverProfile: dp as DriverProfile };
    });
  }

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });

      if (res.status === 401) {
        router.replace(`/auth/login?callbackUrl=${callbackUrl}`);
        return;
      }

      if (res.status === 403) {
        setError("Forbidden");
        setUser(null);
        setDraft(null);
        return;
      }

      const json = (await res.json().catch(() => null)) as ApiOk | ApiErr | null;

      if (!res.ok || !json || !("ok" in json) || !json.ok) {
        setError((json as any)?.error || `Failed to load user (HTTP ${res.status})`);
        setUser(null);
        setDraft(null);
        return;
      }

      setUser(json.user);
      setDraft(json.user);
    } catch (e) {
      console.error(e);
      setError("Failed to load user.");
      setUser(null);
      setDraft(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace(`/auth/login?callbackUrl=${callbackUrl}`);
      return;
    }

    if (!id) {
      setLoading(false);
      setError("Missing user id.");
      return;
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session, id]);

  async function patchDetails(body: any) {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(await readApiError(res));

    const json = await res.json().catch(() => null);
    if (!json?.ok) throw new Error(json?.error || "Update failed.");

    return json.user as UserDetails;
  }

  async function saveAll() {
    if (!draft) return;

    setSaving(true);
    setError(null);

    try {
      const showDriverProfile = draft.role === "DRIVER" || !!draft.driverProfile;

      const updated = await patchDetails({
        role: draft.role,
        accountStatus: draft.accountStatus ?? undefined,
        isAdmin: draft.isAdmin,

        membershipActive: draft.membershipActive,
        membershipPlan: draft.membershipPlan,
        trialEndsAt: draft.trialEndsAt,
        freeMembershipEndsAt: draft.freeMembershipEndsAt,

        addressLine1: draft.addressLine1,
        addressLine2: draft.addressLine2,
        city: draft.city,
        state: draft.state,
        postalCode: draft.postalCode,
        country: draft.country,

        ...(showDriverProfile
          ? {
              driverProfile: {
                verificationStatus: draft.driverProfile?.verificationStatus ?? null,
                plateState: draft.driverProfile?.plateState ?? null,
                plateNumber: draft.driverProfile?.plateNumber ?? null,
                vehicleYear: draft.driverProfile?.vehicleYear ?? null,
                vehicleMake: draft.driverProfile?.vehicleMake ?? null,
                vehicleModel: draft.driverProfile?.vehicleModel ?? null,
                vehicleColor: draft.driverProfile?.vehicleColor ?? null,
                driverLicenseState: draft.driverProfile?.driverLicenseState ?? null,
                driverLicenseNumber: draft.driverProfile?.driverLicenseNumber ?? null,
                driverLicenseExpiry: draft.driverProfile?.driverLicenseExpiry ?? null,
              },
            }
          : {}),
      });

      setUser(updated);
      setDraft(updated);
    } catch (e: any) {
      setError(e?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function sendPasswordReset() {
    if (!draft) return;

    const confirmed = window.confirm(
      `Send a password reset email to ${draft.email}?`
    );

    if (!confirmed) return;

    setResettingPassword(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(id)}/send-password-reset`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!res.ok) throw new Error(await readApiError(res));

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        throw new Error(json?.error || "Could not send password reset email.");
      }

      setSuccess(`Password reset email sent to ${json.sentTo || draft.email}.`);
    } catch (e: any) {
      setError(e?.message || "Could not send password reset email.");
    } finally {
      setResettingPassword(false);
    }
  }  

  async function setTemporaryPassword() {
    if (!draft) return;

    const password = tempPassword.trim();

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    const confirmed = window.confirm(
      `Set a new password for ${draft.email}?`
    );

    if (!confirmed) return;

    setSettingPassword(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(id)}/set-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        }
      );

      if (!res.ok) throw new Error(await readApiError(res));

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        throw new Error(json?.error || "Could not update password.");
      }

      setSuccess("Password updated successfully.");
      setTempPassword("");
    } catch (e: any) {
      setError(e?.message || "Could not update password.");
    } finally {
      setSettingPassword(false);
    }
  }

  async function applyGrant() {
    const raw = grantDays.trim();
    const days = Number(raw);

    if (!raw) return;

    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      alert("Grant days must be between 1 and 3650.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const updated = await patchDetails({ grantDays: days });
      setUser(updated);
      setDraft(updated);
      setGrantDays("");
    } catch (e: any) {
      setError(e?.message || "Grant failed.");
    } finally {
      setSaving(false);
    }
  }

  async function clearGrant() {
    setSaving(true);
    setError(null);

    try {
      const updated = await patchDetails({ freeMembershipEndsAt: null });
      setUser(updated);
      setDraft(updated);
    } catch (e: any) {
      setError(e?.message || "Clear failed.");
    } finally {
      setSaving(false);
    }
  }

  const showDriverProfile = !!draft && (draft.role === "DRIVER" || !!draft.driverProfile);
  const membershipView = draft ? computeMembershipView(draft) : null;

  if (status === "loading") {
    return <main className="p-8 text-sm text-slate-600">Loading…</main>;
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold text-slate-900">User details</h1>
            <p className="mt-1 break-words text-sm text-slate-600">UserId: {id}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/users"
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Back to users
            </Link>

            <button
              type="button"
              onClick={load}
              disabled={saving || loading}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            >
              Refresh
            </button>

            <button
              type="button"
              onClick={sendPasswordReset}
              disabled={resettingPassword || saving || loading || !draft}
              className="rounded-full border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
            >
              {resettingPassword ? "Sending reset…" : "Send password reset"}
            </button>

            <button
              type="button"
              onClick={saveAll}
              disabled={saving || loading || !draft}
              className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 shadow-sm">
            <p className="text-sm font-medium">{error}</p>
          </div>
        ) : null}

        {success ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700 shadow-sm">
            <p className="text-sm font-medium">{success}</p>
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Loading…</p>
          </div>
        ) : !draft ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">No user loaded.</p>
          </div>
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Account</h2>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Field label="Email">
                  <div className="break-words rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    {draft.email}
                  </div>
                </Field>

                <Field label="Public ID (stable external reference)">
                  <div className="break-words rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    {fmt(draft.publicId)}
                  </div>
                </Field>

                <Field label="Name">
                  <input
                    className={inputClass()}
                    value={draft.name ?? ""}
                    onChange={(e) => set("name", e.target.value || null)}
                    placeholder="Name"
                    disabled
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Name is read-only in admin until we decide we want admins to be able to change it.
                  </p>
                </Field>

                <Field label="Role">
                  <select
                    className={inputClass()}
                    value={draft.role}
                    onChange={(e) => set("role", e.target.value as Role)}
                  >
                    <option value="RIDER">RIDER</option>
                    <option value="DRIVER">DRIVER</option>
                    {draft.role === "ADMIN" ? <option value="ADMIN">ADMIN</option> : null}
                  </select>

                  {draft.role !== "ADMIN" ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Admin access is controlled via the isAdmin flag / admin grant, not by selecting ADMIN here.
                    </p>
                  ) : null}
                </Field>

                <Field label="Account status">
                  <select
                    className={inputClass()}
                    value={draft.accountStatus || "ACTIVE"}
                    onChange={(e) => set("accountStatus", e.target.value)}
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                    <option value="DISABLED">DISABLED</option>
                  </select>
                </Field>

                <Field label="Admin access">
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={!!draft.isAdmin}
                      onChange={(e) => set("isAdmin", e.target.checked)}
                    />
                    <span className="text-sm text-slate-800">isAdmin</span>
                  </label>
                </Field>

                <Field label="Created">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    {fmt(draft.createdAt)}
                  </div>
                </Field>

                <Field label="Updated">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    {fmt(draft.updatedAt)}
                  </div>
                </Field>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Password tools</h2>

              <p className="mt-1 text-xs text-slate-500">
                Send a reset link or directly set a new password for this user.
              </p>

              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                <Field label="New password">
                  <input
                    type="text"
                    className={inputClass()}
                    value={tempPassword}
                    onChange={(e) => setTempPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    autoComplete="new-password"
                  />
                </Field>

                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={setTemporaryPassword}
                    disabled={settingPassword || saving || loading || !draft}
                    className="rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                  >
                    {settingPassword ? "Updating..." : "Set password"}
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Billing visibility</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Read-only Stripe/payment data returned by the admin user details API.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Saved cards
                    </h3>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      {draft.paymentMethods?.length ?? 0}
                    </span>
                  </div>

                  <div className="mt-3 space-y-3">
                    {draft.paymentMethods && draft.paymentMethods.length > 0 ? (
                      draft.paymentMethods.map((pm) => (
                        <div
                          key={pm.id}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-slate-900">
                                {formatCardBrand(pm.brand)}
                                {pm.last4 ? ` •••• ${pm.last4}` : ""}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                Exp {formatCardExpiry(pm.expMonth, pm.expYear)}
                                {pm.provider ? ` • ${pm.provider}` : ""}
                              </div>
                            </div>

                            {pm.isDefault ? (
                              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                Default
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                            <div>
                              <span className="font-medium text-slate-500">Created:</span>{" "}
                              {formatIsoShort(pm.createdAt ?? null)}
                            </div>
                            <div>
                              <span className="font-medium text-slate-500">Updated:</span>{" "}
                              {formatIsoShort(pm.updatedAt ?? null)}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                        No saved cards returned by the API.
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Membership charges
                    </h3>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      {draft.membershipCharges?.length ?? 0}
                    </span>
                  </div>

                  <div className="mt-3 space-y-3">
                    {draft.membershipCharges && draft.membershipCharges.length > 0 ? (
                      draft.membershipCharges.map((charge) => (
                        <div
                          key={charge.id}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-slate-900">
                                {formatMoneyCents(charge.amountCents, charge.currency)}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {formatIsoShort(charge.createdAt ?? null)}
                              </div>
                            </div>

                            <StatusBadge value={charge.status} />
                          </div>

                          <div className="mt-3 grid gap-2 text-xs text-slate-600">
                            <div>
                              <span className="font-medium text-slate-500">Provider:</span>{" "}
                              {fmt(charge.provider)}
                            </div>
                            <div className="break-words">
                              <span className="font-medium text-slate-500">Provider ref:</span>{" "}
                              {fmt(charge.providerRef)}
                            </div>
                            <div>
                              <span className="font-medium text-slate-500">Failure reason:</span>{" "}
                              {fmt(charge.failureReason)}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                        No membership charges returned by the API.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Computed membership view
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    This section uses the Membership table first, then falls back to legacy user fields.
                  </p>
                </div>

                {membershipView ? <MembershipBadge value={membershipView.badge} /> : null}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <Field label="Summary">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                    {membershipView?.summary ?? "—"}
                  </div>
                </Field>

                <Field label="Source">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                    {membershipView?.source ?? "—"}
                  </div>
                </Field>

                <Field label="Plan">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                    {fmt(membershipView?.plan ?? draft.membershipPlan)}
                  </div>
                </Field>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                Membership fields & admin grant
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Plan should remain a tier like STANDARD. Trial and grant are time-based states.
              </p>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Field label="Membership active">
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={!!draft.membershipActive}
                      onChange={(e) => set("membershipActive", e.target.checked)}
                    />
                    <span className="text-sm text-slate-800">
                      {draft.membershipActive ? "Active" : "Inactive"}
                    </span>
                  </label>
                </Field>

                <Field label="Plan">
                  <select
                    className={inputClass()}
                    value={draft.membershipPlan ?? ""}
                    onChange={(e) => set("membershipPlan", e.target.value || null)}
                  >
                    <option value="">—</option>
                    {MEMBERSHIP_PLANS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Trial ends">
                  <input
                    className={inputClass()}
                    type="datetime-local"
                    value={isoToLocalInput(draft.trialEndsAt)}
                    onChange={(e) => set("trialEndsAt", localInputToIso(e.target.value))}
                  />
                  <p className="mt-1 text-xs text-slate-500">Stored as ISO in the database.</p>
                </Field>

                <Field label="Admin grant ends">
                  <input
                    className={inputClass()}
                    type="datetime-local"
                    value={isoToLocalInput(draft.freeMembershipEndsAt)}
                    onChange={(e) => set("freeMembershipEndsAt", localInputToIso(e.target.value))}
                  />
                  <p className="mt-1 text-xs text-slate-500">You can also use “Grant days” below.</p>
                </Field>
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-2">
                <div className="w-40">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Grant days
                  </div>
                  <input
                    className={inputClass()}
                    value={grantDays}
                    onChange={(e) => setGrantDays(e.target.value)}
                    placeholder="e.g. 30"
                    inputMode="numeric"
                  />
                </div>

                <button
                  type="button"
                  onClick={applyGrant}
                  disabled={saving || !grantDays.trim()}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  Apply grant
                </button>

                <button
                  type="button"
                  onClick={clearGrant}
                  disabled={saving}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                >
                  Clear grant
                </button>
              </div>
            </section>

            {showDriverProfile ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Driver profile</h2>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <Field label="Verification status">
                    <select
                      className={inputClass()}
                      value={draft.driverProfile?.verificationStatus || ""}
                      onChange={(e) => setDriver("verificationStatus", e.target.value || null)}
                    >
                      <option value="">—</option>
                      <option value="PENDING">PENDING</option>
                      <option value="APPROVED">APPROVED</option>
                      <option value="REJECTED">REJECTED</option>
                    </select>
                  </Field>

                  <Field label="Plate state">
                    <input
                      className={inputClass()}
                      value={draft.driverProfile?.plateState ?? ""}
                      onChange={(e) => setDriver("plateState", e.target.value || null)}
                      placeholder="CA"
                    />
                  </Field>

                  <Field label="Plate number">
                    <input
                      className={inputClass()}
                      value={draft.driverProfile?.plateNumber ?? ""}
                      onChange={(e) => setDriver("plateNumber", e.target.value || null)}
                      placeholder="9ABC123"
                    />
                  </Field>

                  <Field label="Vehicle year">
                    <input
                      className={inputClass()}
                      value={
                        draft.driverProfile?.vehicleYear === null ||
                        draft.driverProfile?.vehicleYear === undefined
                          ? ""
                          : String(draft.driverProfile.vehicleYear)
                      }
                      onChange={(e) => setDriver("vehicleYear", toNumberOrNull(e.target.value))}
                      placeholder="2013"
                      inputMode="numeric"
                    />
                  </Field>

                  <Field label="Vehicle make">
                    <input
                      className={inputClass()}
                      value={draft.driverProfile?.vehicleMake ?? ""}
                      onChange={(e) => setDriver("vehicleMake", e.target.value || null)}
                      placeholder="Toyota"
                    />
                  </Field>

                  <Field label="Vehicle model">
                    <input
                      className={inputClass()}
                      value={draft.driverProfile?.vehicleModel ?? ""}
                      onChange={(e) => setDriver("vehicleModel", e.target.value || null)}
                      placeholder="Avalon"
                    />
                  </Field>

                  <Field label="Vehicle color">
                    <input
                      className={inputClass()}
                      value={draft.driverProfile?.vehicleColor ?? ""}
                      onChange={(e) => setDriver("vehicleColor", e.target.value || null)}
                      placeholder="Gray"
                    />
                  </Field>

                  <Field label="Driver license state">
                    <input
                      className={inputClass()}
                      value={draft.driverProfile?.driverLicenseState ?? ""}
                      onChange={(e) => setDriver("driverLicenseState", e.target.value || null)}
                      placeholder="CA"
                    />
                  </Field>

                  <Field label="Driver license number">
                    <input
                      className={inputClass()}
                      value={draft.driverProfile?.driverLicenseNumber ?? ""}
                      onChange={(e) => setDriver("driverLicenseNumber", e.target.value || null)}
                      placeholder="D1234567"
                    />
                  </Field>

                  <Field label="Driver license expiry (ISO)">
                    <input
                      className={inputClass()}
                      value={draft.driverProfile?.driverLicenseExpiry ?? ""}
                      onChange={(e) => setDriver("driverLicenseExpiry", e.target.value || null)}
                      placeholder="2027-01-01T00:00:00.000Z"
                    />
                  </Field>
                </div>

                <p className="mt-3 text-xs text-slate-500">
                  This section is only shown for DRIVER users or when a driverProfile already exists.
                </p>
              </section>
            ) : (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Driver profile</h2>
                <p className="mt-2 text-sm text-slate-600">
                  This user is not a driver, so driver profile fields are hidden.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}