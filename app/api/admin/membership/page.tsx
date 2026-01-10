"use client";

import { useState } from "react";

type Result =
  | { ok: true; userId: string; membershipId: string; newExpiryDate: string }
  | { ok: false; error: string };

export default function AdminMembershipPage() {
  const [email, setEmail] = useState("");
  const [type, setType] = useState<"RIDER" | "DRIVER">("RIDER");
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit() {
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch("/api/admin/memberships/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, type, days }),
      });

      const data = (await r.json()) as Result;
      setResult(data);
    } catch (e: any) {
      setResult({ ok: false, error: e?.message || "Request failed" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1>Admin: Extend Membership</h1>

      <label style={{ display: "block", marginTop: 12 }}>
        User email
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", padding: 10, marginTop: 6 }}
          placeholder="user@example.com"
        />
      </label>

      <label style={{ display: "block", marginTop: 12 }}>
        Type
        <select
          value={type}
          onChange={(e) => setType(e.target.value as any)}
          style={{ width: "100%", padding: 10, marginTop: 6 }}
        >
          <option value="RIDER">RIDER</option>
          <option value="DRIVER">DRIVER</option>
        </select>
      </label>

      <label style={{ display: "block", marginTop: 12 }}>
        Days to extend
        <input
          type="number"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          style={{ width: "100%", padding: 10, marginTop: 6 }}
          min={1}
        />
      </label>

      <button
        onClick={submit}
        disabled={loading || !email.trim()}
        style={{ marginTop: 16, padding: "10px 14px" }}
      >
        {loading ? "Working..." : "Extend"}
      </button>

      {result && (
        <pre style={{ marginTop: 16, background: "#f6f6f6", padding: 12, overflowX: "auto" }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
