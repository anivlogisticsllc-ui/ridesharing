// src/lib/routes.ts
export const ROUTES = {
  home: "/",

  auth: {
    login: "/auth/login",
    forgotPassword: "/auth/forgot-password",
  },

  account: {
    overview: "/account",
    setupRider: "/account/setup-rider",
    setupDriver: "/account/setup-driver",
    billing: "/account/billing", // NEW: ride payments + payouts + cards
  },

  membership: {
    billing: "/billing/membership", // membership-only charges
  },

  rider: {
    portal: "/rider/portal",
    profile: "/rider/profile",
  },

  driver: {
    portal: "/driver/portal",
    dashboard: "/driver/dashboard",
    profile: "/driver/profile",
  },

  about: "/about",
} as const;
