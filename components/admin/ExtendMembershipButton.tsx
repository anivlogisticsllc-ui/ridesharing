"use client";

import { useState } from "react";

export default function ExtendMembershipButton(props: { userId: string }) {
  const { userId } = props;

  const [days, setDays] = useState(30);
  const [type, setType] = useState<"BOTH" | "RIDER" | "DRIVER">("BOTH");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setMsg(null);

    try {
      const res = await fetch("/api/admin/membership/extend-trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, days, type }),
      });

      const text = await res.text();
      const json = text ? JSON.parse(text) : null;

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Failed (HTTP ${res.status})`);
      }

      const updated = (json.updated || [])
        .map((u: any) => `${u.type}: ${String(u.expiryDate).slice(0, 10)}`)
        .join(" | ");

      setMsg(`Extended: ${updated}`);
    } catch (e: any) {
      setMsg(e?.message || "Failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Days</span>
          <input
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-24 rounded-lg border border-slate-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as any)}
            className="rounded-lg border border-slate-300 px-2 py-1"
          >
            <option value="BOTH">Both</option>
            <option value="RIDER">Rider</option>
            <option value="DRIVER">Driver</option>
          </select>
        </label>

        <button
          type="button"
          onClick={run}
          disabled={loading || !userId}
          className="rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-60"
        >
          {loading ? "Extending..." : "Extend membership"}
        </button>
      </div>

      {msg ? <p className="mt-2 text-xs text-slate-700">{msg}</p> : null}
      <p className="mt-1 text-xs text-slate-500">UserId: {userId}</p>
    </div>
  );
}
