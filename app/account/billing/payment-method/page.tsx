// app/account/billing/payment-method/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";

type DefaultPaymentMethod = {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  updatedAt: string;
};

type StatusResp =
  | {
      ok: true;
      hasPaymentMethod: boolean;
      customerId: string | null;
      defaultPaymentMethod: DefaultPaymentMethod | null;
    }
  | { ok: false; error: string };

type SetupIntentResp =
  | { ok: true; customerId: string; clientSecret: string | null }
  | { ok: false; error: string };

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

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
const STRIPE_PROMISE = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null;

const CALLBACK_PATH = "/account/billing/payment-method";
const LOGIN_URL = "/auth/login?callbackUrl=" + encodeURIComponent(CALLBACK_PATH);

function AddCardForm(props: { clientSecret: string; onSaved: () => Promise<void> }) {
  const { clientSecret, onSaved } = props;
  const stripe = useStripe();
  const elements = useElements();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!stripe || !elements) return;

    setSaving(true);
    setError(null);

    try {
      const { error: submitErr } = await elements.submit();
      if (submitErr) {
        setError(submitErr.message || "Please check the card details.");
        return;
      }

      const result = await stripe.confirmSetup({
        elements,
        clientSecret,
        confirmParams: { return_url: window.location.href },
        redirect: "if_required",
      });

      if (result.error) {
        setError(result.error.message || "Card setup failed.");
        return;
      }

      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Add a card</h2>
        <p className="mt-1 text-sm text-slate-600">
          We’ll save your card for ride payments. Membership billing is handled separately once you activate a plan.
        </p>

        <div className="mt-4">
          <PaymentElement />
        </div>

        {error ? (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="mt-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !stripe || !elements}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save card"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PaymentMethodPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hasCard, setHasCard] = useState(false);
  const [defaultCard, setDefaultCard] = useState<DefaultPaymentMethod | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  async function loadStatus() {
    const res = await fetch("/api/billing/payment-method", { cache: "no-store" });

    if (res.status === 401) {
      router.replace(LOGIN_URL);
      return;
    }

    const json = (await res.json().catch(() => null)) as StatusResp | null;
    if (!res.ok || !json || !("ok" in json) || !json.ok) {
      setHasCard(false);
      setDefaultCard(null);
      setError((json as any)?.error || `Failed to load (HTTP ${res.status}).`);
      return;
    }

    setError(null);
    setHasCard(json.hasPaymentMethod);
    setDefaultCard(json.defaultPaymentMethod);
  }

  async function createSetupIntent() {
    if (!STRIPE_PROMISE) return; // no Stripe in env

    setCreating(true);
    try {
      const res = await fetch("/api/billing/setup-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      if (!res.ok) throw new Error(await readApiError(res));

      const json = (await res.json().catch(() => null)) as SetupIntentResp | null;
      if (!json || !("ok" in json) || !json.ok || !json.clientSecret) {
        throw new Error((json as any)?.error || "Failed to create setup intent.");
      }

      setClientSecret(json.clientSecret);
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.replace(LOGIN_URL);
      return;
    }

    let mounted = true;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        await loadStatus();
        await createSetupIntent(); // keep ready so user can add/replace card quickly
      } catch (e: any) {
        if (mounted) setError(e?.message || "Failed to load payment method page.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session]);

  const elementsOptions = useMemo(() => {
    if (!clientSecret) return null;
    return { clientSecret };
  }, [clientSecret]);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Payment method</h1>
            <p className="mt-1 text-sm text-slate-600">
              Add a card to enable CARD rides and to serve as backup for CASH rides during trial.
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Back
          </button>
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
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Card on file</h2>

              {hasCard && defaultCard ? (
                <div className="mt-3 text-sm text-slate-800">
                  <div>
                    <span className="font-medium">Default:</span>{" "}
                    {defaultCard.brand || "Card"} •••• {defaultCard.last4 || "—"}{" "}
                    {defaultCard.expMonth && defaultCard.expYear
                      ? `(exp ${defaultCard.expMonth}/${defaultCard.expYear})`
                      : ""}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Updated: {new Date(defaultCard.updatedAt).toLocaleString()}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-600">No card saved yet.</p>
              )}

              <p className="mt-3 text-xs text-slate-500">
                The newest saved card becomes your default.
              </p>
            </section>

            {!PUBLISHABLE_KEY || !STRIPE_PROMISE ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 shadow-sm">
                Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in your environment.
              </div>
            ) : !clientSecret || !elementsOptions ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-600">
                  {creating ? "Preparing card form…" : "Card form not ready."}
                </p>
              </div>
            ) : (
              <Elements stripe={STRIPE_PROMISE} options={elementsOptions}>
                <AddCardForm
                  clientSecret={clientSecret}
                  onSaved={async () => {
                    // Stripe/DB updates can lag slightly in dev; give it a beat.
                    await new Promise((r) => setTimeout(r, 900));
                    await loadStatus();
                    await createSetupIntent(); // keep page ready for a swap
                    router.refresh();
                  }}
                />
              </Elements>
            )}
          </>
        )}
      </div>
    </main>
  );
}