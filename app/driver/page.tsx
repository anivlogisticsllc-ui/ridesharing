"use client";

import { useState } from "react";

export default function DriverPostRidePage() {
  const [originCity, setOriginCity] = useState("");
  const [destinationCity, setDestinationCity] = useState("");
  const [distanceMiles, setDistanceMiles] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [availableRiders, setAvailableRiders] = useState("1");

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/rides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originCity,
          destinationCity,
          distanceMiles: Number(distanceMiles),
          departureTime, // ISO string from datetime-local input
          availableSeats: Number(availableRiders),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to create ride");
      }

      setMessage("Ride posted successfully.");
      // Reset form
      setOriginCity("");
      setDestinationCity("");
      setDistanceMiles("");
      setDepartureTime("");
      setAvailableRiders("1");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="mx-auto max-w-xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">
          Post a ride
        </h1>
        <p className="text-sm text-slate-600 mb-6">
          Share a trip you&apos;re already taking and let riders join you.
          Pricing is automatically calculated as{" "}
          <span className="font-medium">$3 booking + $2 per mile</span> for the
          whole ride.
        </p>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl bg-white border border-slate-200 p-5 shadow-sm"
        >
          <div>
            <label className="block text-sm font-medium text-slate-800 mb-1">
              From (city)
            </label>
            <input
              type="text"
              value={originCity}
              onChange={(e) => setOriginCity(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="San Francisco, CA"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-800 mb-1">
              To (city)
            </label>
            <input
              type="text"
              value={destinationCity}
              onChange={(e) => setDestinationCity(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="San Jose, CA"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">
                Distance (miles)
              </label>
              <input
                type="number"
                min={1}
                step="0.1"
                value={distanceMiles}
                onChange={(e) => setDistanceMiles(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. 40"
              />
              <p className="mt-1 text-xs text-slate-500">
                Used to calculate price: $3 + $2 × miles.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-800 mb-1">
                Departure time
              </label>
              <input
                type="datetime-local"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-800 mb-1">
              How many riders can join?
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={availableRiders}
              onChange={(e) => setAvailableRiders(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Info / preview */}
          {distanceMiles && (
            <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-2 text-xs text-slate-700">
              Estimated price for this ride:{" "}
              <span className="font-semibold">
                $
                {(
                  3 +
                  2 * Number(distanceMiles || 0)
                ).toFixed(2)}
              </span>{" "}
              total (booking + distance).
            </div>
          )}

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
            disabled={submitting}
            className="w-full rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {submitting ? "Posting ride..." : "Post ride"}
          </button>
        </form>
      </div>
    </main>
  );
}
