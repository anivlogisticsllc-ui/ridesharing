"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

type OutstandingPayload = {
  id: string;
  status: string;
  totalCents: number;
  fareCents: number;
  convenienceFeeCents: number;
  currency: string;
  reason: string;
  note: string | null;
  createdAt: string;
  ride: {
    id: string;
    originCity: string;
    destinationCity: string;
    departureTime: string;
    tripCompletedAt: string | null;
  };
  driverName: string | null;
};

type GetResp =
  | { ok: true; outstanding: OutstandingPayload }
  | { ok: false; error: string };

type ActionResp =
  | { ok: true; status: string }
  | { ok: false; error: string };

function formatMoney(cents: number, currency: string) {
  const amount = (cents || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

async function readJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function readApiError(res: Response): Promise<string> {
  const json = await readJsonSafe<any>(res);
  const msg = json?.error ?? json?.message;
  if (typeof msg === "string" && msg.trim()) return msg;
  return `Request failed (HTTP ${res.status}).`;
}

function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 15000, ...rest } = init;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...rest, signal: controller.signal }).finally(() => clearTimeout(t));
}

function RiderOutstandingInner() {
  const sp = useSearchParams();
  const router = useRouter();

  const oc = useMemo(() => (sp?.get("oc") ?? "").trim(), [sp]);

  const [loading, setLoading] = useState(true);
  const [outstanding, setOutstanding] = useState<OutstandingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [acting, setActing] = useState<"PAY" | "DISPUTE" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // prevent duplicate loads in dev StrictMode from racing each other
  const loadSeq = useRef(0);

  async function loadOutstanding(id: string) {
    const seq = ++loadSeq.current;

    setLoading(true);
    setError(null);

    try {
      const res = await fetchWithTimeout(`/api/rider/outstanding-charge?oc=${encodeURIComponent(id)}`, {
        cache: "no-store",
        timeoutMs: 15000,
      });

      const json = await readJsonSafe<GetResp>(res);

      // ignore stale request result
      if (seq !== loadSeq.current) return;

      if (!res.ok || !json?.ok) {
        const msg = json && "error" in json ? json.error : `Failed to load outstanding charge (HTTP ${res.status}).`;
        throw new Error(msg);
      }

      setOutstanding(json.outstanding);
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      setOutstanding(null);
      if (e?.name === "AbortError") setError("Request timed out. Please refresh and try again.");
      else setError(e instanceof Error ? e.message : "Failed to load outstanding charge.");
    } finally {
      if (seq !== loadSeq.current) return;
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!oc) {
      setError("Missing oc.");
      setLoading(false);
      return;
    }
    loadOutstanding(oc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oc]);

  async function doAction(action: "PAY" | "DISPUTE") {
    if (!outstanding) return;

    // hard stop: don't allow actions when not OPEN
    if (outstanding.status !== "OPEN") return;

    setActing(action);
    setActionError(null);

    try {
      const res = await fetchWithTimeout("/api/rider/outstanding-charge/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oc: outstanding.id, action }),
        timeoutMs: 20000,
      });

      if (!res.ok) throw new Error(await readApiError(res));

      const json = await readJsonSafe<ActionResp>(res);
      if (!json || !json.ok) throw new Error(json && "error" in json ? json.error : "Action failed.");

      // reload details after action completes
      await loadOutstanding(outstanding.id);
    } catch (e: any) {
      if (e?.name === "AbortError") setActionError("Action timed out. Please try again.");
      else setActionError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setActing(null);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-slate-600">Loading…</div>;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-sm text-rose-700">{error}</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="mt-4 rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white"
        >
          Go home
        </button>
      </div>
    );
  }

  if (!outstanding) return null;

  const dtRide = new Date(outstanding.ride.departureTime);
  const dtCreated = new Date(outstanding.createdAt);

  const isOpen = outstanding.status === "OPEN";

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
        <h1 className="text-xl font-semibold text-slate-900">Outstanding charge</h1>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">
            {outstanding.ride.originCity} → {outstanding.ride.destinationCity}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Ride time: {dtRide.toLocaleString()} • Driver: {outstanding.driverName ?? "Unknown"}
          </p>
          <p className="mt-1 text-xs text-slate-500">Created: {dtCreated.toLocaleString()}</p>

          <div className="mt-4 grid gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Fare</span>
              <span className="font-medium">{formatMoney(outstanding.fareCents, outstanding.currency)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Convenience fee</span>
              <span className="font-medium">{formatMoney(outstanding.convenienceFeeCents, outstanding.currency)}</span>
            </div>
            <div className="flex items-center justify-between border-t pt-2">
              <span className="text-slate-900 font-semibold">Total</span>
              <span className="text-slate-900 font-semibold">
                {formatMoney(outstanding.totalCents, outstanding.currency)}
              </span>
            </div>
          </div>

          <div className="mt-3 text-xs text-slate-600">
            <div>
              Status: <span className="font-semibold text-slate-900">{outstanding.status}</span>
            </div>
            <div>
              Reason: <span className="font-medium text-slate-800">{outstanding.reason}</span>
            </div>
            {outstanding.note ? <div className="mt-1">Note: {outstanding.note}</div> : null}
          </div>

          {actionError ? (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {actionError}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => doAction("PAY")}
              disabled={!isOpen || acting !== null}
              className={`rounded-full px-4 py-2 text-xs font-medium text-white ${
                !isOpen || acting !== null ? "bg-slate-400 opacity-60" : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              {acting === "PAY" ? "Paying…" : "Pay now"}
            </button>

            <button
              type="button"
              onClick={() => doAction("DISPUTE")}
              disabled={!isOpen || acting !== null}
              className={`rounded-full border px-4 py-2 text-xs font-medium ${
                !isOpen || acting !== null
                  ? "border-slate-200 bg-slate-50 text-slate-400"
                  : "border-rose-300 bg-white text-rose-700 hover:bg-rose-50"
              }`}
            >
              {acting === "DISPUTE" ? "Submitting…" : "Dispute"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function RiderOutstandingPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-2xl px-4 py-10 text-sm text-slate-600">Loading…</div>}>
      <RiderOutstandingInner />
    </Suspense>
  );
}