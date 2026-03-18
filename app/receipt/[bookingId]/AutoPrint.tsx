"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

export default function AutoPrint() {
  const searchParams = useSearchParams();
  const printedRef = useRef(false);

  useEffect(() => {
    if (printedRef.current) return;

    const sp = searchParams ?? new URLSearchParams();
    if (sp.get("autoprint") !== "1") return;

    printedRef.current = true;

    const t = window.setTimeout(() => {
      window.print();
    }, 400);

    return () => window.clearTimeout(t);
  }, [searchParams]);

  return null;
}
