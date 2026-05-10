"use client";

import { SessionProvider } from "next-auth/react";
import React from "react";
import RiderActiveTripRedirect from "@/components/rider/RiderActiveTripRedirect";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <RiderActiveTripRedirect />
      {children}
    </SessionProvider>
  );
}