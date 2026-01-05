"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

export default function AutoPrint() {
  const sp = useSearchParams();
  const printedRef = useRef(false);

  useEffect(() => {
    if (printedRef.current) return;
    if (sp.get("autoprint") !== "1") return;

    printedRef.current = true;

    // Give layout/fonts a beat to settle
    const t = window.setTimeout(() => window.print(), 200);
    return () => window.clearTimeout(t);
  }, [sp]);

  return null;
}
