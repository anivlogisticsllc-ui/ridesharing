"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type DepartureMode = "ASAP" | "SCHEDULED";
type PaymentType = "CARD" | "CASH";

type AddressSuggestion = {
  id: string;
  label: string;
  streetNumber: string;
  streetName: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
};

type DistanceResult = {
  miles: number;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  
};

type GeoEstimateSuccess = {
  ok: true;
  miles: number;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
};

type GeoEstimateError = {
  ok: false;
  error: string;
};

type GeoSuggestSuccess = {
  ok: true;
  suggestions: AddressSuggestion[];
};

type GeoSuggestError = {
  ok: false;
  error: string;
};

type PaymentMethodStatus =
  | {
      ok: true;
      hasPaymentMethod: boolean;
      customerId: string | null;
      defaultPaymentMethod: any | null;
    }
  | { ok: false; error: string };

function buildAddress(parts: {
  streetNumber: string;
  streetName: string;
  city: string;
  state: string;
  zip: string;
}) {
  const street = [parts.streetNumber.trim(), parts.streetName.trim()]
    .filter(Boolean)
    .join(" ");
  const cityState = [parts.city.trim(), parts.state.trim().toUpperCase()]
    .filter(Boolean)
    .join(", ");
  const zip = parts.zip.trim();

  if (!street || !cityState || !zip) return "";
  return `${street}, ${cityState} ${zip}`;
}

function safeUuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function RiderRequestFormHome() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Top-level UI state
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outstandingOcId, setOutstandingOcId] = useState<string | null>(null);

  // Card-on-file status
  const [pmLoading, setPmLoading] = useState(false);
  const [hasCardOnFile, setHasCardOnFile] = useState<boolean>(false);
  const [pmChecked, setPmChecked] = useState<boolean>(false);

  // Visible address search box values
  const [originQuery, setOriginQuery] = useState("");
  const [destQuery, setDestQuery] = useState("");

  // Origin address
  const [originStreetNumber, setOriginStreetNumber] = useState("");
  const [originStreetName, setOriginStreetName] = useState("");
  const [originCity, setOriginCity] = useState("");
  const [originStateVal, setOriginStateVal] = useState("");
  const [originZip, setOriginZip] = useState("");

  // Destination address
  const [destStreetNumber, setDestStreetNumber] = useState("");
  const [destStreetName, setDestStreetName] = useState("");
  const [destCity, setDestCity] = useState("");
  const [destStateVal, setDestStateVal] = useState("");
  const [destZip, setDestZip] = useState("");

  const [departureMode, setDepartureMode] = useState<DepartureMode>("ASAP");
  const [departureTime, setDepartureTime] = useState("");
  const [distanceMiles, setDistanceMiles] = useState<number | "">("");
  const [passengerCount, setPassengerCount] = useState<number | "">(1);

  const [paymentType, setPaymentType] = useState<PaymentType>("CASH");

  const [submitting, setSubmitting] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [clientRequestId, setClientRequestId] = useState<string>(() => safeUuid());

  const originAddress = useMemo(
    () =>
      buildAddress({
        streetNumber: originStreetNumber,
        streetName: originStreetName,
        city: originCity,
        state: originStateVal,
        zip: originZip,
      }),
    [originStreetNumber, originStreetName, originCity, originStateVal, originZip]
  );

  const destinationAddress = useMemo(
    () =>
      buildAddress({
        streetNumber: destStreetNumber,
        streetName: destStreetName,
        city: destCity,
        state: destStateVal,
        zip: destZip,
      }),
    [destStreetNumber, destStreetName, destCity, destStateVal, destZip]
  );

  async function loadPaymentMethodStatus(opts?: { silent?: boolean }) {
    if (!session) return;

    setPmLoading(true);
    try {
      const res = await fetch("/api/billing/payment-method", { cache: "no-store" });

      if (res.status === 401) {
        router.push("/auth/login?callbackUrl=/");
        return;
      }

      const json = (await res.json().catch(() => null)) as PaymentMethodStatus | null;

      if (!res.ok || !json || !("ok" in json) || !json.ok) {
        setHasCardOnFile(false);
        if (!opts?.silent) {
          setError((json as any)?.error || `Failed to load payment method status (HTTP ${res.status}).`);
        }
        return;
      }

      setHasCardOnFile(Boolean(json.hasPaymentMethod));
      if (!opts?.silent) setError(null);
    } finally {
      setPmChecked(true);
      setPmLoading(false);
    }
  }

  useEffect(() => {
    if (status === "loading") return;
    if (!session) return;
    void loadPaymentMethodStatus({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session]);

  async function estimateDistanceOnce(opts?: { showUserError?: boolean }): Promise<DistanceResult | null> {
    if (!originAddress || !destinationAddress) {
      if (opts?.showUserError) setError("Please fill out all address fields for From and To.");
      return null;
    }

    try {
      setEstimating(true);

      const res = await fetch("/api/geo/estimate-distance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originAddress, destinationAddress }),
      });

      const data = (await res.json()) as GeoEstimateSuccess | GeoEstimateError;

      if (!res.ok || !data.ok) {
        if (opts?.showUserError) {
          setError(
            "Could not estimate distance for these addresses." +
              ("error" in data && data.error ? ` Details: ${data.error}` : "")
          );
        }
        return null;
      }

      return {
        miles: data.miles,
        originLat: data.origin.lat,
        originLng: data.origin.lng,
        destLat: data.destination.lat,
        destLng: data.destination.lng,
      };
    } catch (err) {
      console.error("[estimateDistanceOnce] error", err);
      if (opts?.showUserError) setError("Failed to estimate distance. Try again or enter it manually.");
      return null;
    } finally {
      setEstimating(false);
    }
  }

  function resetForm() {
    setOriginQuery("");
    setDestQuery("");

    setOriginStreetNumber("");
    setOriginStreetName("");
    setOriginCity("");
    setOriginStateVal("");
    setOriginZip("");

    setDestStreetNumber("");
    setDestStreetName("");
    setDestCity("");
    setDestStateVal("");
    setDestZip("");

    setDepartureMode("ASAP");
    setDepartureTime("");
    setDistanceMiles("");
    setPassengerCount(1);

    setClientRequestId(safeUuid());
    setPaymentType("CASH");
  }

  function goAddCard() {
    router.push("/account/billing/payment-method");
  }

  function requireCardGate(): boolean {
    if (!pmChecked) {
      setError("Checking your payment method status… please try again in a moment.");
      return false;
    }

    if (!hasCardOnFile) {
      setError("Please add a card on file before booking.");
      return false;
    }

    return true;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setOutstandingOcId(null);

    if (!session) {
      router.push("/auth/login?callbackUrl=/");
      return;
    }

    await loadPaymentMethodStatus({ silent: true });
    if (!requireCardGate()) return;

    if (!originAddress || !destinationAddress) {
      setError("Please fill out all address fields for From and To.");
      return;
    }

    if (!/^\d{5}$/.test(originZip.trim()) || !/^\d{5}$/.test(destZip.trim())) {
      setError("ZIP codes must be 5 digits.");
      return;
    }

    const passengersNumber = typeof passengerCount === "number" ? passengerCount : Number(passengerCount || 1);
    if (!passengersNumber || passengersNumber < 1 || passengersNumber > 6) {
      setError("Passenger count must be between 1 and 6.");
      return;
    }

    let distanceToSend =
      typeof distanceMiles === "number" ? distanceMiles : distanceMiles === "" ? null : Number(distanceMiles);
    if (distanceToSend != null && Number.isNaN(distanceToSend)) distanceToSend = null;

    const geo = await estimateDistanceOnce({ showUserError: true });
    if (!geo) return;

    const originLat = geo.originLat;
    const originLng = geo.originLng;
    const destLat = geo.destLat;
    const destLng = geo.destLng;

    if (distanceToSend == null) {
      distanceToSend = geo.miles;
      setDistanceMiles(Number(geo.miles.toFixed(1)));
    }

    if (!distanceToSend || Number.isNaN(distanceToSend) || distanceToSend <= 0) {
      setError("Please provide a valid distance in miles.");
      return;
    }

    let departureToSend: string;
    if (departureMode === "ASAP") {
      departureToSend = new Date().toISOString();
    } else {
      if (!departureTime) {
        setError("Please select a departure time.");
        return;
      }
      departureToSend = new Date(departureTime).toISOString();
    }

    try {
      setSubmitting(true);

      const res = await fetch("/api/rides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRequestId,
          originCity: originAddress,
          originLat,
          originLng,
          destinationCity: destinationAddress,
          destinationLat: destLat,
          destinationLng: destLng,
          departureTime: departureToSend,
          passengerCount: passengersNumber,
          distanceMiles: distanceToSend,
          paymentType,
        }),
      });

      type PostRideResponse =
        | { ok: true }
        | { ok: false; error: string; outstandingChargeId?: string };

      const data = (await res.json().catch(() => null)) as PostRideResponse | null;

      if (!res.ok || !data || !data.ok) {
        const msg = data && "error" in data ? data.error : "Failed to post ride request";
        setError(msg);

        const oc = data && "outstandingChargeId" in data ? data.outstandingChargeId : undefined;
        setOutstandingOcId(typeof oc === "string" && oc.trim() ? oc : null);
        return;
      }

      setMessage("Ride request posted. You can see it in your Rider portal.");
      resetForm();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return <p className="py-4 text-sm text-slate-500">Loading…</p>;
  }

  if (!session) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Request a ride</h2>
        <p className="text-sm text-slate-600">Sign in to request a ride.</p>
        <button
          type="button"
          onClick={() => router.push("/auth/login?callbackUrl=/")}
          className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
        >
          Sign in
        </button>
      </section>
    );
  }

  const bookingBlockedNoCard = pmChecked && !hasCardOnFile;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">Request a ride</h2>

      {/* Cash promo / warning */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="font-medium">Cash rides</div>
        <div className="mt-1 text-amber-900">
          Cash rides can receive a <b>10% discount</b> only if cash is paid in-person.
        </div>
        <div className="mt-2 text-amber-800">
          If a cash ride isn’t paid in cash, we may charge the card on file and the cash discount will not apply.
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="space-y-2">
          <span className="block text-sm font-medium text-slate-800">Payment method</span>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="paymentType"
                value="CASH"
                checked={paymentType === "CASH"}
                onChange={() => setPaymentType("CASH")}
              />
              <span>
                CASH <span className="text-emerald-700">(10% off if paid in cash)</span>
              </span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="paymentType"
                value="CARD"
                checked={paymentType === "CARD"}
                onChange={() => setPaymentType("CARD")}
              />
              <span>CARD</span>
            </label>
          </div>
        </div>

        {bookingBlockedNoCard ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            You need to add a card before booking a ride.
            <div className="mt-2">
              <button
                type="button"
                onClick={goAddCard}
                className="inline-flex rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-800"
              >
                Add a card
              </button>
              <button
                type="button"
                onClick={() => void loadPaymentMethodStatus({ silent: false })}
                disabled={pmLoading}
                className="ml-2 inline-flex rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                {pmLoading ? "Checking…" : "Refresh"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          {/* FROM */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-800">From (address)</p>

            <AddressSearchBox
              placeholder="Search starting address"
              value={originQuery}
              onChangeValue={setOriginQuery}
              onSelect={(s) => {
                setOriginStreetNumber(s.streetNumber);
                setOriginStreetName(s.streetName);
                setOriginCity(s.city);
                setOriginStateVal(s.state);
                setOriginZip(s.zip);
              }}
            />

            <div className="grid grid-cols-[minmax(0,0.5fr)_minmax(0,1.5fr)] gap-2">
              <div>
                <label className="mb-1 block text-xs text-slate-600">No.</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={originStreetNumber}
                  onChange={(e) => setOriginStreetNumber(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-600">Street</label>
                <input
                  type="text"
                  value={originStreetName}
                  onChange={(e) => setOriginStreetName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)] gap-2">
              <div>
                <label className="mb-1 block text-xs text-slate-600">City</label>
                <input
                  type="text"
                  value={originCity}
                  onChange={(e) => setOriginCity(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-600">State</label>
                  <input
                    type="text"
                    value={originStateVal}
                    onChange={(e) => setOriginStateVal(e.target.value.toUpperCase())}
                    maxLength={2}
                    placeholder="CA"
                    required
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-600">ZIP</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{5}"
                    value={originZip}
                    onChange={(e) => setOriginZip(e.target.value)}
                    placeholder="94002"
                    required
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* TO */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-800">To (address)</p>

            <AddressSearchBox
              placeholder="Search destination address"
              value={destQuery}
              onChangeValue={setDestQuery}
              onSelect={(s) => {
                setDestStreetNumber(s.streetNumber);
                setDestStreetName(s.streetName);
                setDestCity(s.city);
                setDestStateVal(s.state);
                setDestZip(s.zip);
              }}
            />

            <div className="grid grid-cols-[minmax(0,0.5fr)_minmax(0,1.5fr)] gap-2">
              <div>
                <label className="mb-1 block text-xs text-slate-600">No.</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={destStreetNumber}
                  onChange={(e) => setDestStreetNumber(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-600">Street</label>
                <input
                  type="text"
                  value={destStreetName}
                  onChange={(e) => setDestStreetName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)] gap-2">
              <div>
                <label className="mb-1 block text-xs text-slate-600">City</label>
                <input
                  type="text"
                  value={destCity}
                  onChange={(e) => setDestCity(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-600">State</label>
                  <input
                    type="text"
                    value={destStateVal}
                    onChange={(e) => setDestStateVal(e.target.value.toUpperCase())}
                    maxLength={2}
                    placeholder="CA"
                    required
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-600">ZIP</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{5}"
                    value={destZip}
                    onChange={(e) => setDestZip(e.target.value)}
                    placeholder="95110"
                    required
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Departure mode */}
        <div className="space-y-2">
          <span className="block text-sm font-medium text-slate-800">Departure time</span>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="departureMode"
                value="ASAP"
                checked={departureMode === "ASAP"}
                onChange={() => setDepartureMode("ASAP")}
              />
              <span>ASAP (default)</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="departureMode"
                value="SCHEDULED"
                checked={departureMode === "SCHEDULED"}
                onChange={() => setDepartureMode("SCHEDULED")}
              />
              <span>Schedule a time</span>
            </label>
          </div>

          {departureMode === "SCHEDULED" && (
            <div className="mt-2 max-w-xs">
              <input
                type="datetime-local"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}
        </div>

        {/* Distance + passengers */}
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">Distance (miles)</label>
            <input
              type="number"
              min={1}
              value={distanceMiles}
              onChange={(e) => setDistanceMiles(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="Leave blank to auto-estimate"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={() => {
                setError(null);
                estimateDistanceOnce({ showUserError: true }).then((result) => {
                  if (result) setDistanceMiles(Number(result.miles.toFixed(1)));
                });
              }}
              disabled={estimating}
              className="mt-1 text-xs text-indigo-700 hover:underline disabled:opacity-60"
            >
              {estimating ? "Estimating…" : "Estimate distance from addresses"}
            </button>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">Number of passengers</label>
            <input
              type="number"
              min={1}
              max={6}
              value={passengerCount}
              onChange={(e) => setPassengerCount(e.target.value === "" ? "" : Number(e.target.value))}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {message && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {message}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <div>{error}</div>

            {outstandingOcId ? (
              <button
                type="button"
                onClick={() => router.push(`/rider/outstanding?oc=${encodeURIComponent(outstandingOcId)}`)}
                className="mt-2 inline-flex rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-800"
              >
                Pay now
              </button>
            ) : null}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || estimating || bookingBlockedNoCard || pmLoading}
          className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {submitting ? "Posting…" : bookingBlockedNoCard ? "Add a card to book" : "Post ride request"}
        </button>
      </form>
    </section>
  );
}

/* ---------- Address search box (Mapbox autocomplete) ---------- */

function AddressSearchBox(props: {
  placeholder?: string;
  value: string;
  onChangeValue: (value: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
}) {
  const { placeholder, value, onChangeValue, onSelect } = props;

  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  async function fetchSuggestions(nextValue: string) {
    const trimmed = nextValue.trim();
    setLocalError(null);

    if (trimmed.length < 3) {
      setSuggestions([]);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    try {
      setLoading(true);

      const res = await fetch(`/api/geo/suggest?q=${encodeURIComponent(trimmed)}&limit=5`);
      const data = (await res.json()) as GeoSuggestSuccess | GeoSuggestError;

      if (!res.ok || !data.ok) {
        setLocalError("No suggestions found.");
        setSuggestions([]);
        setOpen(false);
        setActiveIndex(-1);
        return;
      }

      const list = data.suggestions || [];
      setSuggestions(list);
      setOpen(list.length > 0);
      setActiveIndex(list.length > 0 ? 0 : -1);
    } catch (err) {
      console.error("[AddressSearchBox] error", err);
      setLocalError("Failed to load suggestions.");
      setSuggestions([]);
      setOpen(false);
      setActiveIndex(-1);
    } finally {
      setLoading(false);
    }
  }

  function applySuggestion(index: number) {
    const s = suggestions[index];
    if (!s) return;

    onSelect(s);
    onChangeValue(s.label);

    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) {
      if (e.key === "ArrowDown" && value.trim().length >= 3) {
        e.preventDefault();
        setOpen(true);
        setActiveIndex(0);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((prev) => (prev + 1 >= suggestions.length ? 0 : prev + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((prev) => (prev - 1 < 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        e.preventDefault();
        applySuggestion(activeIndex);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          onChangeValue(next);
          void fetchSuggestions(next);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || "Search address"}
        autoComplete="off"
        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      {loading && <div className="mt-1 text-[11px] text-slate-400">Looking up suggestions…</div>}
      {localError && <div className="mt-1 text-[11px] text-rose-500">{localError}</div>}

      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-slate-200 bg-white text-sm shadow-lg">
          {suggestions.map((s, index) => (
            <li
              key={s.id}
              className={`cursor-pointer px-2 py-1.5 ${
                index === activeIndex ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-50"
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(index);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}