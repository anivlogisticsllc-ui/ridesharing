// app/account/billing/payment-method/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

type SavedCard = {
  id: string;
  provider: string | null;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  stripePaymentMethodId: string | null;
  isDefault: boolean;
  updatedAt: string;
};

type StatusResp =
  | {
      ok: true;
      hasPaymentMethod: boolean;
      customerId: string | null;
      cards: SavedCard[];
      defaultPaymentMethod: SavedCard | null;
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

function formatCard(card: SavedCard) {
  const brand = card.brand ? card.brand.toUpperCase() : "CARD";
  const last4 = card.last4 || "—";
  return `${brand} •••• ${last4}`;
}

function formatExp(card: SavedCard) {
  if (!card.expMonth || !card.expYear) return "Exp —";
  return `Exp ${card.expMonth}/${card.expYear}`;
}

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

      const setupIntentId =
        typeof result.setupIntent?.id === "string" ? result.setupIntent.id : null;

      if (!setupIntentId) {
        throw new Error("SetupIntent was created, but no setupIntentId was returned.");
      }

      const syncRes = await fetch("/api/billing/payment-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ setupIntentId }),
      });

      if (!syncRes.ok) {
        throw new Error(await readApiError(syncRes));
      }

      await onSaved();
    } catch (e: any) {
      setError(e?.message || "Could not save card.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Add a card</h2>

      <p className="mt-1 text-sm text-slate-600">
        Add another card or replace your current default payment method.
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
    </section>
  );
}

export default function PaymentMethodPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyCardId, setBusyCardId] = useState<string | null>(null);
  const [setupKey, setSetupKey] = useState(0);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [cards, setCards] = useState<SavedCard[]>([]);
  const [defaultCard, setDefaultCard] = useState<SavedCard | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  async function loadStatus() {
    const res = await fetch("/api/billing/payment-method", { cache: "no-store" });

    if (res.status === 401) {
      router.replace(LOGIN_URL);
      return;
    }

    const json = (await res.json().catch(() => null)) as StatusResp | null;

    if (!res.ok || !json || !("ok" in json) || !json.ok) {
      setCards([]);
      setDefaultCard(null);
      setError((json as any)?.error || `Failed to load (HTTP ${res.status}).`);
      return;
    }

    setError(null);
    setCards(json.cards || []);
    setDefaultCard(json.defaultPaymentMethod);
  }

  async function createSetupIntent() {
    if (!STRIPE_PROMISE) return;

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
      setSetupKey((n) => n + 1);
    } finally {
      setCreating(false);
    }
  }

  async function makeDefault(paymentMethodId: string) {
    setBusyCardId(paymentMethodId);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/billing/payment-method/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ paymentMethodId }),
      });

      if (!res.ok) throw new Error(await readApiError(res));

      setSuccess("Default card updated.");
      await loadStatus();
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Could not update default card.");
    } finally {
      setBusyCardId(null);
    }
  }

  async function deleteCard(paymentMethodId: string) {
    const confirmed = window.confirm("Delete this saved card?");
    if (!confirmed) return;

    setBusyCardId(paymentMethodId);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/billing/payment-method", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ paymentMethodId }),
      });

      if (!res.ok) throw new Error(await readApiError(res));

      setSuccess("Card deleted.");
      await loadStatus();
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Could not delete card.");
    } finally {
      setBusyCardId(null);
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
        await createSetupIntent();
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
            <h1 className="text-3xl font-semibold text-slate-900">Payment methods</h1>
            <p className="mt-1 text-sm text-slate-600">
              Manage saved cards for rides, cash backup charges, and membership billing.
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

        {success ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700 shadow-sm">
            <p className="text-sm font-medium">{success}</p>
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Loading…</p>
          </div>
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Saved cards</h2>

              {cards.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">No card saved yet.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {cards.map((card) => (
                    <div key={card.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {formatCard(card)}
                          </div>

                          <div className="mt-1 text-xs text-slate-500">
                            {formatExp(card)} · Updated{" "}
                            {new Date(card.updatedAt).toLocaleString()}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {card.isDefault ? (
                            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                              Default
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => makeDefault(card.id)}
                              disabled={busyCardId === card.id}
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                              Make default
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => deleteCard(card.id)}
                            disabled={busyCardId === card.id}
                            className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {defaultCard ? (
                <p className="mt-3 text-xs text-slate-500">
                  Current default: {formatCard(defaultCard)}.
                </p>
              ) : (
                <p className="mt-3 text-xs text-slate-500">
                  The next saved card will become your default.
                </p>
              )}
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
              <Elements key={setupKey} stripe={STRIPE_PROMISE} options={elementsOptions}>
                <AddCardForm
                  clientSecret={clientSecret}
                  onSaved={async () => {
                    await new Promise((r) => setTimeout(r, 900));
                    setSuccess("Card saved successfully.");
                    await loadStatus();
                    await createSetupIntent();
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