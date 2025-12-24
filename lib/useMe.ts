"use client";

import { useEffect, useState } from "react";
import type { MeMembership } from "./membership";

export type MeResponse =
  | {
      ok: true;
      user: {
        id: string;
        name: string | null;
        email: string;
        role: "RIDER" | "DRIVER" | "BOTH";
        onboardingCompleted: boolean;
      };
      membership: MeMembership;
    }
  | {
      ok: false;
      error: string;
    };

let mePromise: Promise<MeResponse> | null = null;

async function fetchMe(): Promise<MeResponse> {
  const res = await fetch("/api/auth/me", { cache: "no-store" });
  const json = (await res.json()) as MeResponse;

  if (!res.ok) {
    const msg =
      (json && (json as any).ok === false && (json as any).error) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return json;
}

export function useMe() {
  const [data, setData] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setLoading(true);
        if (!mePromise) mePromise = fetchMe();
        const json = await mePromise;
        if (!cancelled) setData(json);
      } catch (e: any) {
        // If the memoized promise failed, allow a retry on next mount.
        mePromise = null;
        if (!cancelled) setData({ ok: false, error: e?.message || "Failed to load /api/auth/me" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading };
}
