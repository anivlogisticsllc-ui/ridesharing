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

  createdAt: string | null;
  updatedAt: string | null;

  driverProfile: DriverProfile | null;
};

type ApiOk = { ok: true; user: UserDetails };
type ApiErr = { ok: false; error: string };

const MEMBERSHIP_PLANS = ["STANDARD", "PREMIUM"] as const;

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
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function inputClass() {
  return "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
}

function fmt(v: any) {
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
      const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, { cache: "no-store" });

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

    // IMPORTANT: you now allow non-ADMIN via freeMembershipEndsAt / isAdmin flag at API level.
    // So the page should NOT block here. Let the API enforce.
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
        // Role: do NOT allow promoting to ADMIN via dropdown; only keep it if already admin
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

        // Only send driverProfile if it should exist (prevents accidental upsert for riders)
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

  if (status === "loading") {
    return <main className="p-8 text-sm text-slate-600">Loading…</main>;
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold text-slate-900">User details</h1>
            <p className="mt-1 text-sm text-slate-600 break-words">UserId: {id}</p>
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
            {/* Account */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Account</h2>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Field label="Email">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm break-words">
                    {draft.email}
                  </div>
                </Field>

                <Field label="Public ID (stable external reference)">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm break-words">
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

            {/* Membership + Admin grant */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Membership & Admin grant</h2>

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

            {/* Driver profile (UI fix: only show for drivers or if it exists already) */}
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
                  This section is only shown for DRIVER users (or when a driverProfile already exists).
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
