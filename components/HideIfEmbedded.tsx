"use client";

import { useState } from "react";

export function HideIfEmbedded({ children }: { children: React.ReactNode }) {
  const [embedded] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.self !== window.top;
    } catch {
      // Cross-origin iframe → assume embedded
      return true;
    }
  });

  if (embedded) return null;
  return <>{children}</>;
}
