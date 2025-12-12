"use client";

import { useEffect, useState } from "react";

export function HideIfEmbedded({ children }: { children: React.ReactNode }) {
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    try {
      if (window.self !== window.top) {
        setEmbedded(true);
      }
    } catch {
      // Cross-origin iframe → assume embedded
      setEmbedded(true);
    }
  }, []);

  if (embedded) return null;
  return <>{children}</>;
}
