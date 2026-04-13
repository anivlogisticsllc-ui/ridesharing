// app/admin/payouts/page.tsx

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Role = "RIDER" | "DRIVER" | "ADMIN";
type PayoutWeekStatus = "PAID" | "PENDING" | "FAILED" | "NONE";

function asRole(v: unknown): Role | null {
  return v === "RIDER" || v === "DRIVER" || v === "ADMIN" ? v : null;
}

type DriverListRow = {
  id: string;
  email: string;
  name: string | null;
  role: "DRIVER";
  isAdmin: boolean;
  accountStatus: string | null;
  createdAt: string;
  updatedAt: string;
  publicId: string | null;
  onboardingCompleted: boolean;
  membershipActive: boolean;
  membershipPlan: string | null;
  trialEndsAt: string | null;
};

type DriversApiResponse =
  | { ok: true; drivers: DriverListRow[] }
  | { ok: false; error: string; detail?: string };

type DriverInfo = {
  id: string;
  name: string | null;
  email: string;
  stripeConnectedAccountId: string | null;
  stripePayoutsEnabled: boolean;
  stripeChargesEnabled: boolean;
  stripeAccountReady: boolean;
  externalBankLast4: string | null;
  externalBankName: string | null;
};

type DriverPayoutWeek = {
  key: string;
  weekStart: string;
  weekEnd: string;
  label: string;

  payoutStatus: PayoutWeekStatus;
  payoutId: string | null;
  payoutCreatedAt: string | null;
  payoutAmountCents: number;

  includedGrossAmountCents: number;
  includedServiceFeeCents: number;
  includedNetAmountCents: number;

  excludedGrossAmountCents: number;
  excludedServiceFeeCents: number;
  excludedNetAmountCents: number;

  includedRideCount: number;
  excludedRideCount: number;

  cardPayableGrossAmountCents: number;
  cardPayableServiceFeeCents: number;
  cardPayableNetAmountCents: number;

  cashCollectedGrossAmountCents: number;
  cashCollectedServiceFeeCents: number;
  cashCollectedNetAmountCents: number;

  cashPreservedGrossAmountCents: number;
  cashPreservedServiceFeeCents: number;
  cashPreservedNetAmountCents: number;

  refundAdjustedGrossAmountCents: number;
  refundAdjustedServiceFeeCents: number;
  refundAdjustedNetAmountCents: number;

  driverDisputeFeeCents: number;
  netAfterDisputeFeeCents: number;

  cashRideServiceFeeOffsetCents: number;
  finalTransferAmountCents: number;
};

type BillingResponse =
  | {
      ok: true;
      driver: DriverInfo;
      weeklyPayouts: DriverPayoutWeek[];
      payoutView: {
        defaultWeekKey: string | null;
        lastPaidWeekKey: string | null;
        currentPendingWeekKey: string | null;
        weekOptions: {
          key: string;
          label: string;
          payoutStatus: PayoutWeekStatus;
          payoutAmountCents: number;
          includedNetAmountCents: number;
          includedRideCount: number;
          excludedRideCount: number;
          finalTransferAmountCents: number;
          cashRideServiceFeeOffsetCents: number;
          driverDisputeFeeCents: number;
          netAfterDisputeFeeCents: number;
        }[];
      };
    }
  | {
      ok: false;
      error: string;
    };

type CreatePayoutResponse =
  | {
      ok: true;
      payout: {
        id: string;
        amountCents: number;
        currency: string;
        status: string;
        provider: string;
        payoutWeekKey: string | null;
        payoutWeekStart: string | null;
        payoutWeekEnd: string | null;
        cardPayableNetAmountCents: number;
        cashRideServiceFeeOffsetCents: number;
        driverDisputeFeeCents: number;
        createdAt: string;
      };
    }
  | {
      ok: false;
      error: string;
      existingPayout?: {
        id: string;
        status: string;
        amountCents: number;
        createdAt: string;
      };
    };

type ExecutePayoutResponse =
  | {
      ok: true;
      payout: {
        id: string;
        amountCents: number;
        currency: string;
        status: string;
        provider: string;
        providerRef: string | null;
        payoutWeekKey: string | null;
        payoutWeekStart: string | null;
        payoutWeekEnd: string | null;
        cardPayableNetAmountCents: number;
        cashRideServiceFeeOffsetCents: number;
        driverDisputeFeeCents: number;
        createdAt: string;
        updatedAt: string;
        executedAt: string | null;
        failureReason: string | null;
      };
      transfer: {
        id: string;
        amount: number;
        currency: string;
        destination: string | null;
      };
      driver: {
        id: string;
        name: string | null;
        email: string;
        stripeConnectedAccountId: string;
        externalBankName: string | null;
        externalBankLast4: string | null;
      };
    }
  | {
      ok: false;
      error: string;
      payout?: {
        id: string;
        status: string;
        providerRef: string | null;
        failureReason?: string | null;
      };
      driver?: {
        id: string;
        email: string | null;
        stripeConnectedAccountId: string | null;
        stripePayoutsEnabled?: boolean;
        stripeChargesEnabled?: boolean;
        stripeAccountReady?: boolean;
      };
    };

function money(cents: number, currency = "USD") {
  const amount = (Number.isFinite(cents) ? cents : 0) / 100;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amount);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function fmt(value: string | null | undefined) {
  if (!value) return "—";
  return value;
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

export default function AdminPayoutsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const role = asRole((session?.user as { role?: unknown } | undefined)?.role);

  const [q, setQ] = useState("");
  const [drivers, setDrivers] = useState<DriverListRow[]>([]);
  const [driversLoading, setDriversLoading] = useState(true);
  const [driversRefreshing, setDriversRefreshing] = useState(false);

  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [selectedDriverRow, setSelectedDriverRow] = useState<DriverListRow | null>(null);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [executing, setExecuting] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [weeklyPayouts, setWeeklyPayouts] = useState<DriverPayoutWeek[]>([]);
  const [selectedWeekKey, setSelectedWeekKey] = useState("");

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace("/auth/login?callbackUrl=/admin/payouts");
      return;
    }

    if (role !== "ADMIN") {
      router.replace("/");
      return;
    }

    void loadDrivers(true);
  }, [status, session, role, router]);

  async function loadDrivers(spinner = false) {
    try {
      setError(null);

      if (spinner) setDriversLoading(true);
      else setDriversRefreshing(true);

      const url =
        q.trim().length > 0
          ? `/api/admin/drivers?q=${encodeURIComponent(q.trim())}`
          : "/api/admin/drivers";

      const res = await fetch(url, { cache: "no-store" });

      if (res.status === 401) {
        router.replace("/auth/login?callbackUrl=/admin/payouts");
        return;
      }

      if (res.status === 403) {
        throw new Error("Forbidden");
      }

      if (!res.ok) {
        throw new Error(await readApiError(res));
      }

      const json = (await res.json().catch(() => null)) as DriversApiResponse | null;

      if (!json || !("ok" in json) || !json.ok) {
        throw new Error(
          (json as { error?: string } | null)?.error || "Failed to load drivers."
        );
      }

      setDrivers(json.drivers);

      if (selectedDriverId) {
        const stillExists = json.drivers.find((d) => d.id === selectedDriverId) ?? null;
        setSelectedDriverRow(stillExists);
      }
    } catch (e) {
      setDrivers([]);
      setError(e instanceof Error ? e.message : "Failed to load drivers.");
    } finally {
      setDriversLoading(false);
      setDriversRefreshing(false);
    }
  }

  async function loadDriverPayouts(driverId: string) {
    try {
      setPreviewLoading(true);
      setError(null);
      setSuccess(null);

      const res = await fetch("/api/account/billing/driver", {
        method: "GET",
        headers: {
          "x-admin-driver-id": driverId,
        },
        cache: "no-store",
      });

      const json = (await res.json().catch(() => null)) as BillingResponse | null;

      if (!res.ok || !json || !("ok" in json) || !json.ok) {
        throw new Error(
          (json as { error?: string } | null)?.error ||
            `Failed to load driver payout preview (HTTP ${res.status})`
        );
      }

      setDriver(json.driver);
      setWeeklyPayouts(json.weeklyPayouts);
      setSelectedWeekKey(
        json.payoutView.defaultWeekKey || json.weeklyPayouts[0]?.key || ""
      );
    } catch (e) {
      setDriver(null);
      setWeeklyPayouts([]);
      setSelectedWeekKey("");
      setError(e instanceof Error ? e.message : "Failed to load payout preview.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function selectDriver(row: DriverListRow) {
    setSelectedDriverId(row.id);
    setSelectedDriverRow(row);
    await loadDriverPayouts(row.id);
  }

  async function createPayout() {
    if (!selectedDriverId) {
      setError("Select a driver first.");
      return;
    }

    if (!selectedWeekKey) {
      setError("Select a payout week first.");
      return;
    }

    try {
      setCreating(true);
      setError(null);
      setSuccess(null);

      const res = await fetch("/api/admin/payouts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          driverId: selectedDriverId,
          payoutWeekKey: selectedWeekKey,
        }),
      });

      const json = (await res.json().catch(() => null)) as CreatePayoutResponse | null;

      if (!res.ok || !json || !("ok" in json) || !json.ok) {
        if (res.status === 409 && json && "existingPayout" in json && json.existingPayout) {
          throw new Error(
            `Payout already exists. Status: ${json.existingPayout.status}. ` +
              `Payout ID: ${json.existingPayout.id}. ` +
              `Created: ${formatDateTime(json.existingPayout.createdAt)}`
          );
        }

        throw new Error(
          (json as { error?: string } | null)?.error ||
            `Failed to create payout record (HTTP ${res.status})`
        );
      }

      setSuccess(
        `Payout record created: ${json.payout.id} for ${money(json.payout.amountCents)}`
      );

      await loadDriverPayouts(selectedDriverId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create payout.");
    } finally {
      setCreating(false);
    }
  }

  async function executePayout() {
    if (!selectedWeek?.payoutId) {
      setError("No payout record exists for the selected week.");
      return;
    }

    try {
      setExecuting(true);
      setError(null);
      setSuccess(null);

      const res = await fetch("/api/admin/payouts/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payoutId: selectedWeek.payoutId,
        }),
      });

      const json = (await res.json().catch(() => null)) as ExecutePayoutResponse | null;

      if (!res.ok || !json || !("ok" in json) || !json.ok) {
        const failureReason =
          json && "payout" in json && json.payout?.failureReason
            ? ` Reason: ${json.payout.failureReason}`
            : "";

        throw new Error(
          ((json as { error?: string } | null)?.error ||
            `Failed to send payout (HTTP ${res.status})`) + failureReason
        );
      }

      const bankInfo =
        json.driver.externalBankName || json.driver.externalBankLast4
          ? ` to ${json.driver.externalBankName || "bank"} / last4 ${json.driver.externalBankLast4 || "—"}`
          : "";

      setSuccess(
        `Payout sent: ${json.payout.id} for ${money(json.payout.amountCents)}. ` +
          `Stripe transfer: ${json.transfer.id}${bankInfo}`
      );

      await loadDriverPayouts(selectedDriverId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send payout.");
      await loadDriverPayouts(selectedDriverId);
    } finally {
      setExecuting(false);
    }
  }

  const selectedWeek = useMemo(() => {
    return weeklyPayouts.find((w) => w.key === selectedWeekKey) ?? null;
  }, [weeklyPayouts, selectedWeekKey]);

  const isPayoutReady =
    Boolean(driver?.stripeConnectedAccountId) &&
    Boolean(driver?.stripePayoutsEnabled) &&
    Boolean(driver?.stripeAccountReady);

  const canCreate =
    !!selectedWeek &&
    (selectedWeek.payoutStatus === "NONE" || selectedWeek.payoutStatus === "FAILED") &&
    !creating &&
    !executing;

  const canExecute =
    !!selectedWeek &&
    selectedWeek.payoutStatus === "PENDING" &&
    !!selectedWeek.payoutId &&
    isPayoutReady &&
    !creating &&
    !executing;

  const actionLabel = creating
    ? "Creating…"
    : executing
    ? "Sending…"
    : selectedWeek?.payoutStatus === "PAID"
    ? "Paid"
    : selectedWeek?.payoutStatus === "PENDING"
    ? "Send payout"
    : "Create payout record";

  const actionDisabled =
    creating ||
    executing ||
    !selectedWeek ||
    selectedWeek.payoutStatus === "PAID" ||
    (selectedWeek.payoutStatus === "PENDING" ? !canExecute : false) ||
    ((selectedWeek.payoutStatus === "NONE" || selectedWeek.payoutStatus === "FAILED")
      ? !canCreate
      : false);

  async function handlePrimaryAction() {
    if (!selectedWeek) return;

    if (
      selectedWeek.payoutStatus === "NONE" ||
      selectedWeek.payoutStatus === "FAILED"
    ) {
      await createPayout();
      return;
    }

    if (selectedWeek.payoutStatus === "PENDING") {
      await executePayout();
    }
  }

  if (status === "loading") {
    return <main className="p-8 text-sm text-slate-600">Loading…</main>;
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Admin payouts</h1>
            <p className="mt-1 text-sm text-slate-600">
              Select a driver, review payout week totals, create the payout record, then send the payout.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin"
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Back to Admin
            </Link>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 shadow-sm">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700 shadow-sm">
            {success}
          </div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[280px] flex-1">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Search drivers
              </label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, email, publicId…"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadDrivers(false);
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => void loadDrivers(false)}
              disabled={driversLoading || driversRefreshing}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            >
              {driversRefreshing ? "Refreshing…" : "Apply"}
            </button>
          </div>

          <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-[1.6fr_1.1fr_0.9fr_0.9fr_0.8fr] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <div>Driver</div>
              <div>Public ID / User ID</div>
              <div>Onboarding</div>
              <div>Membership</div>
              <div></div>
            </div>

            {driversLoading ? (
              <div className="px-4 py-6 text-sm text-slate-600">Loading drivers…</div>
            ) : drivers.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-600">No drivers found.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {drivers.map((row) => {
                  const selected = row.id === selectedDriverId;

                  return (
                    <div
                      key={row.id}
                      className={`grid grid-cols-[1.6fr_1.1fr_0.9fr_0.9fr_0.8fr] gap-3 px-4 py-4 ${
                        selected ? "bg-indigo-50" : "bg-white"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">{row.name || "—"}</div>
                        <div className="break-words text-sm text-slate-600">{row.email}</div>
                      </div>

                      <div className="text-sm text-slate-700">
                        <div>publicId: {fmt(row.publicId)}</div>
                        <div className="mt-1 break-all text-xs text-slate-500">
                          userId: {row.id}
                        </div>
                      </div>

                      <div className="text-sm text-slate-700">
                        {row.onboardingCompleted ? "Completed" : "Not completed"}
                      </div>

                      <div className="text-sm text-slate-700">
                        {row.membershipActive ? row.membershipPlan || "Active" : "Inactive"}
                      </div>

                      <div className="flex items-start justify-end">
                        <button
                          type="button"
                          onClick={() => void selectDriver(row)}
                          className={`rounded-full px-4 py-2 text-sm font-medium ${
                            selected
                              ? "border border-indigo-700 bg-indigo-700 text-white"
                              : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                          }`}
                        >
                          {selected ? "Selected" : "Select"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {selectedDriverRow ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Selected driver</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Driver</div>
                <div className="mt-2 text-sm text-slate-900">
                  {selectedDriverRow.name || "—"} ({selectedDriverRow.email})
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  publicId: {fmt(selectedDriverRow.publicId)}
                </div>
                <div className="mt-1 break-all text-xs text-slate-500">
                  userId: {selectedDriverRow.id}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Preview status
                </div>
                <div className="mt-2 text-sm text-slate-900">
                  {previewLoading ? "Loading payout preview…" : "Preview ready"}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {driver ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Driver payout readiness</h2>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Driver</div>
                <div className="mt-2 text-sm text-slate-900">
                  {driver.name || "—"} ({driver.email})
                </div>
                <div className="mt-1 break-all text-xs text-slate-500">ID: {driver.id}</div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Stripe Connect
                </div>
                <div className="mt-2 text-sm text-slate-900">
                  Connected account: {driver.stripeConnectedAccountId || "—"}
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  payoutsEnabled: {String(driver.stripePayoutsEnabled)} | chargesEnabled:{" "}
                  {String(driver.stripeChargesEnabled)} | accountReady:{" "}
                  {String(driver.stripeAccountReady)}
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  Bank: {driver.externalBankName || "—"} / last4 {driver.externalBankLast4 || "—"}
                </div>
              </div>
            </div>

            {!isPayoutReady ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Driver is not payout-ready yet. Finish Stripe Connect setup before sending payouts.
              </div>
            ) : null}
          </section>
        ) : null}

        {weeklyPayouts.length > 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payout week
                </label>
                <select
                  value={selectedWeekKey}
                  onChange={(e) => setSelectedWeekKey(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {weeklyPayouts.map((week) => (
                    <option key={week.key} value={week.key}>
                      {week.label} | {week.payoutStatus} | transfer {money(week.finalTransferAmountCents)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void handlePrimaryAction()}
                  disabled={actionDisabled}
                  className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionLabel}
                </button>
              </div>
            </div>

            {selectedWeek ? (
              <>
                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Card payable net
                    </div>
                    <div className="mt-2 text-xl font-semibold text-slate-900">
                      {money(selectedWeek.cardPayableNetAmountCents)}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Cash fee offset
                    </div>
                    <div className="mt-2 text-xl font-semibold text-slate-900">
                      {money(selectedWeek.cashRideServiceFeeOffsetCents)}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Driver dispute fee
                    </div>
                    <div className="mt-2 text-xl font-semibold text-slate-900">
                      {money(selectedWeek.driverDisputeFeeCents)}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Final transfer amount
                    </div>
                    <div className="mt-2 text-xl font-semibold text-slate-900">
                      {money(selectedWeek.finalTransferAmountCents)}
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
                  <div>Payout status: {selectedWeek.payoutStatus}</div>
                  <div>Payout ID: {selectedWeek.payoutId || "—"}</div>
                  <div>Created: {formatDateTime(selectedWeek.payoutCreatedAt)}</div>
                  <div>Included rides: {selectedWeek.includedRideCount}</div>
                  <div>Excluded rides: {selectedWeek.excludedRideCount}</div>
                </div>

                {selectedWeek.payoutStatus === "PENDING" ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    A payout record exists for this week and is ready for the next step.
                    <div className="mt-1">Payout ID: {selectedWeek.payoutId || "—"}</div>
                    <div>Created: {formatDateTime(selectedWeek.payoutCreatedAt)}</div>
                    {!isPayoutReady ? (
                      <div className="mt-2">
                        Sending is blocked until the driver Stripe account is payout-ready.
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {selectedWeek.payoutStatus === "FAILED" ? (
                  <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                    This payout failed and needs to be recreated or reviewed before retrying.
                    <div className="mt-1">Payout ID: {selectedWeek.payoutId || "—"}</div>
                    <div>Created: {formatDateTime(selectedWeek.payoutCreatedAt)}</div>
                  </div>
                ) : null}

                {selectedWeek.payoutStatus === "PAID" ? (
                  <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                    This payout week has already been paid.
                    <div className="mt-1">Payout ID: {selectedWeek.payoutId || "—"}</div>
                    <div>Created: {formatDateTime(selectedWeek.payoutCreatedAt)}</div>
                  </div>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}