// app/driver/rides/[id]/ResendReceiptButton.tsx
"use client";

import { useState } from "react";

async function readApiError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return `Request failed (HTTP ${res.status}).`;
  try {
    const json = JSON.parse(text);
    return json?.error || json?.message || `Request failed (HTTP ${res.status}).`;
  } catch {
    return text.slice(0, 300) || `Request failed (HTTP ${res.status}).`;
  }
}

export function ResendReceiptButton({ rideId }: { rideId: string }) {
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleClick() {
    if (sending) return;
    setSending(true);
    setMsg(null);

    try {
      const res = await fetch("/api/rider/resend-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rideId }),
      });

      if (!res.ok) throw new Error(await readApiError(res));

      const data = await res.json().catch(() => null);
      if (!data?.ok) throw new Error(data?.error || "Failed to resend receipt.");

      setMsg("Receipt email sent.");
    } catch (e: any) {
      setMsg(e?.message || "Failed to resend receipt.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={sending}
        className={`rounded-full px-4 py-2 text-xs font-medium text-white ${
          sending ? "cursor-not-allowed bg-slate-400 opacity-70" : "bg-indigo-600 hover:bg-indigo-700"
        }`}
      >
        {sending ? "Emailing…" : "Email receipt"}
      </button>

      {msg ? <p className="text-xs text-slate-600">{msg}</p> : null}
    </div>
  );
}
