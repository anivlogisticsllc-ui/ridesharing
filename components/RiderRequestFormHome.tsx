"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type DepartureMode = "ASAP" | "SCHEDULED";

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

export function RiderRequestFormHome() {
  const { data: session, status } = useSession();
  const router = useRouter();

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

  const [departureMode, setDepartureMode] =
    useState<DepartureMode>("ASAP");
  const [departureTime, setDepartureTime] = useState("");
  const [distanceMiles, setDistanceMiles] = useState<number | "">("");
  const [passengerCount, setPassengerCount] =
    useState<number | "">(1);

  const [submitting, setSubmitting] = useState(false);
  const [estimating, setEstimating] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Require login
  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.replace("/auth/login?callbackUrl=/");
    }
  }, [session, status, router]);

  async function estimateDistanceOnce(opts?: {
    showUserError?: boolean;
  }): Promise<DistanceResult | null> {
    const originAddress = buildAddress({
      streetNumber: originStreetNumber,
      streetName: originStreetName,
      city: originCity,
      state: originStateVal,
      zip: originZip,
    });

    const destinationAddress = buildAddress({
      streetNumber: destStreetNumber,
      streetName: destStreetName,
      city: destCity,
      state: destStateVal,
      zip: destZip,
    });

    if (!originAddress || !destinationAddress) {
      if (opts?.showUserError) {
        setError("Please fill out all address fields for From and To.");
      }
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
              (("error" in data && data.error)
                ? ` Details: ${data.error}`
                : "")
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
      if (opts?.showUserError) {
        setError("Failed to estimate distance. Try again or enter it manually.");
      }
      return null;
    } finally {
      setEstimating(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const originAddress = buildAddress({
      streetNumber: originStreetNumber,
      streetName: originStreetName,
      city: originCity,
      state: originStateVal,
      zip: originZip,
    });

    const destinationAddress = buildAddress({
      streetNumber: destStreetNumber,
      streetName: destStreetName,
      city: destCity,
      state: destStateVal,
      zip: destZip,
    });

    if (!originAddress || !destinationAddress) {
      setError("Please fill out all address fields for From and To.");
      return;
    }

    // Basic ZIP validation (client-side only; still validate server-side in /api/rides)
    if (!/^\d{5}$/.test(originZip.trim()) || !/^\d{5}$/.test(destZip.trim())) {
      setError("ZIP codes must be 5 digits.");
      return;
    }

    let originLat = 0;
    let originLng = 0;
    let destLat = 0;
    let destLng = 0;

    let distanceToSend =
      typeof distanceMiles === "number"
        ? distanceMiles
        : distanceMiles === ""
        ? null
        : Number(distanceMiles);

    // If user left distance blank, try to auto-estimate it
    if (distanceToSend == null) {
      const result = await estimateDistanceOnce({ showUserError: true });
      if (!result) return;

      distanceToSend = result.miles;
      originLat = result.originLat;
      originLng = result.originLng;
      destLat = result.destLat;
      destLng = result.destLng;

      setDistanceMiles(Number(result.miles.toFixed(1)));
    }

    if (!distanceToSend || Number.isNaN(distanceToSend)) {
      setError("Please provide a valid distance in miles.");
      return;
    }

    // Basic passenger range check
    const passengersNumber =
      typeof passengerCount === "number"
        ? passengerCount
        : Number(passengerCount || 1);
    if (!passengersNumber || passengersNumber < 1 || passengersNumber > 6) {
      setError("Passenger count must be between 1 and 6.");
      return;
    }

    try {
      setSubmitting(true);

      let departureToSend: string;
      if (departureMode === "ASAP") {
        departureToSend = new Date().toISOString();
      } else {
        if (!departureTime) {
          setError("Please select a departure time.");
          setSubmitting(false);
          return;
        }
        departureToSend = new Date(departureTime).toISOString();
      }

      const res = await fetch("/api/rides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originCity: originAddress,
          originLat,
          originLng,
          destinationCity: destinationAddress,
          destinationLat: destLat,
          destinationLng: destLng,
          departureTime: departureToSend,
          passengerCount: passengersNumber,
          distanceMiles: distanceToSend,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to post ride request");
      }

      setMessage(
        "Ride request posted. You can see it in your Rider portal."
      );

      // Reset form
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
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading" || !session) {
    return (
      <p className="py-4 text-sm text-slate-500">
        Loading your rider account…
      </p>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">
        Request a ride
      </h2>

      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-2xl bg-white border border-slate-200 p-5 shadow-sm"
      >
        {/* From / To structured address fields + autocomplete */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* FROM */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-800">
              From (address)
            </p>

            <AddressSearchBox
              placeholder="Search starting address"
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
                <label className="block text-xs text-slate-600 mb-1">
                  No.
                </label>
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
                <label className="block text-xs text-slate-600 mb-1">
                  Street
                </label>
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
                <label className="block text-xs text-slate-600 mb-1">
                  City
                </label>
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
                  <label className="block text-xs text-slate-600 mb-1">
                    State
                  </label>
                  <input
                    type="text"
                    value={originStateVal}
                    onChange={(e) =>
                      setOriginStateVal(e.target.value.toUpperCase())
                    }
                    maxLength={2}
                    placeholder="CA"
                    required
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">
                    ZIP
                  </label>
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
            <p className="text-sm font-medium text-slate-800">
              To (address)
            </p>

            <AddressSearchBox
              placeholder="Search destination address"
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
                <label className="block text-xs text-slate-600 mb-1">
                  No.
                </label>
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
                <label className="block text-xs text-slate-600 mb-1">
                  Street
                </label>
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
                <label className="block text-xs text-slate-600 mb-1">
                  City
                </label>
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
                  <label className="block text-xs text-slate-600 mb-1">
                    State
                  </label>
                  <input
                    type="text"
                    value={destStateVal}
                    onChange={(e) =>
                      setDestStateVal(e.target.value.toUpperCase())
                    }
                    maxLength={2}
                    placeholder="CA"
                    required
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">
                    ZIP
                  </label>
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
          <span className="block text-sm font-medium text-slate-800">
            Departure time
          </span>
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
            <label className="block text-sm font-medium text-slate-800 mb-1">
              Distance (miles)
            </label>
            <input
              type="number"
              min={1}
              value={distanceMiles}
              onChange={(e) =>
                setDistanceMiles(
                  e.target.value === "" ? "" : Number(e.target.value)
                )
              }
              placeholder="Leave blank to auto-estimate"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={() => {
                setError(null);
                estimateDistanceOnce({ showUserError: true }).then(
                  (result) => {
                    if (result) {
                      setDistanceMiles(Number(result.miles.toFixed(1)));
                    }
                  }
                );
              }}
              disabled={estimating}
              className="mt-1 text-xs text-indigo-700 hover:underline disabled:opacity-60"
            >
              {estimating ? "Estimating…" : "Estimate distance from addresses"}
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-800 mb-1">
              Number of passengers
            </label>
            <input
              type="number"
              min={1}
              max={6}
              value={passengerCount}
              onChange={(e) =>
                setPassengerCount(
                  e.target.value === "" ? "" : Number(e.target.value)
                )
              }
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {message && (
          <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
            {message}
          </div>
        )}
        {error && (
          <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-800">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || estimating}
          className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {submitting ? "Posting…" : "Post ride request"}
        </button>
      </form>
    </section>
  );
}

/* ---------- Address search box (Mapbox autocomplete) ---------- */

function AddressSearchBox(props: {
  placeholder?: string;
  onSelect: (suggestion: AddressSuggestion) => void;
}) {
  const { placeholder, onSelect } = props;

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  async function fetchSuggestions(value: string) {
    const trimmed = value.trim();
    setLocalError(null);

    if (trimmed.length < 3) {
      setSuggestions([]);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    try {
      setLoading(true);

      const res = await fetch(
        `/api/geo/suggest?q=${encodeURIComponent(trimmed)}&limit=5`
      );

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
    setQuery(s.label);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // If list is empty, let key behave normally
    if (!suggestions.length) {
      // Small boost: ArrowDown can open list if query is long enough
      if (e.key === "ArrowDown" && query.trim().length >= 3) {
        e.preventDefault();
        setOpen(true);
        setActiveIndex(0);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((prev) => {
        const next = prev + 1;
        return next >= suggestions.length ? 0 : next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((prev) => {
        const next = prev - 1;
        return next < 0 ? suggestions.length - 1 : next;
      });
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
        value={query}
        onChange={(e) => {
          const value = e.target.value;
          setQuery(value);
          void fetchSuggestions(value);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || "Search address"}
        autoComplete="off"
        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      {loading && (
        <div className="mt-1 text-[11px] text-slate-400">
          Looking up suggestions…
        </div>
      )}

      {localError && (
        <div className="mt-1 text-[11px] text-rose-500">
          {localError}
        </div>
      )}

      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-slate-200 bg-white text-sm shadow-lg">
          {suggestions.map((s, index) => (
            <li
              key={s.id}
              className={`cursor-pointer px-2 py-1.5 ${
                index === activeIndex
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
              onMouseDown={(e) => {
                // prevent blur before click fires
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
