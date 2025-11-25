// components/PostRideForm.tsx
"use client";

import { useState } from "react";

export function PostRideForm() {
  const [originCity, setOriginCity] = useState("");
  const [destinationCity, setDestinationCity] = useState("");
  const [distanceMiles, setDistanceMiles] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [availableSeats, setAvailableSeats] = useState("1");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
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
          departureTime: departureTime
            ? new Date(departureTime).toISOString()
            : null,
          availableSeats: Number(availableSeats),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to create ride");
      }

      setMessage("Ride posted successfully.");
      // Clear form
      setOriginCity("");
      setDestinationCity("");
      setDistanceMiles("");
      setDepartureTime("");
      setAvailableSeats("1");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">
        Post a new ride (dev mode)
      </h2>
      <p className="text-xs text-slate-500">
        For now this uses a demo driver account. We&apos;ll connect real
        authentication later.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-700">
            Origin city
          </label>
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            value={originCity}
            onChange={(e) => setOriginCity(e.target.value)}
            placeholder="San Francisco, CA"
            required
          />
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-700">
            Destination city
          </label>
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            value={destinationCity}
            onChange={(e) => setDestinationCity(e.target.value)}
            placeholder="San Jose, CA"
            required
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-700">
            Distance (miles)
          </label>
          <input
            type="number"
            min={1}
            step="0.1"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            value={distanceMiles}
            onChange={(e) => setDistanceMiles(e.target.value)}
            placeholder="40"
            required
          />
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-700">
            Available seats
          </label>
          <input
            type="number"
            min={1}
            max={6}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            value={availableSeats}
            onChange={(e) => setAvailableSeats(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-700">
            Departure time
          </label>
          <input
            type="datetime-local"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            value={departureTime}
            onChange={(e) => setDepartureTime(e.target.value)}
            required
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
      >
        {isSubmitting ? "Posting..." : "Post ride"}
      </button>

      {message && (
        <p className="text-xs text-emerald-600 mt-1">{message}</p>
      )}
      {error && (
        <p className="text-xs text-red-600 mt-1">{error}</p>
      )}
    </form>
  );
}
