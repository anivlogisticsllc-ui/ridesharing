"use client";

import { useEffect, useState } from "react";

export function HideIfEmbedded({ children }: { children: React.ReactNode }) {
  // SSR + first client render MUST match.
  // So we render children until we've mounted and can safely check window.top.
  const [mounted, setMounted] = useState(false);
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    setMounted(true);

    try {
      setEmbedded(window.self !== window.top);
    } catch {
      // Cross-origin iframe → assume embedded
      setEmbedded(true);
    }
  }, []);

  // Important: during SSR and first client render, render children.
  if (!mounted) return <>{children}</>;

  if (embedded) return null;
  return <>{children}</>;
}
