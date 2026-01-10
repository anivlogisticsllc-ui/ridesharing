// pages/api/mapbox/forward-geocode.ts
import type { NextApiRequest, NextApiResponse } from "next";

type Suggestion = {
  id: string;
  label: string;
  streetNumber: string;
  streetName: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
};

type ApiResponse =
  | { ok: true; suggestions: Suggestion[] }
  | { ok: false; error: string };

// Default center (San Francisco-ish)
const DEFAULT_NEAR_LAT = 37.7749;
const DEFAULT_NEAR_LNG = -122.4194;

// Radius for “local” results
const MAX_RADIUS_MILES = 400;

function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8; // miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function makeBoundingBox(
  centerLat: number,
  centerLng: number,
  radiusMiles: number
) {
  // Rough conversion: 1° lat ≈ 69 miles
  const latDelta = radiusMiles / 69;

  const latRad = (centerLat * Math.PI) / 180;
  const milesPerDegLng = 69 * Math.cos(latRad) || 1; // avoid divide-by-zero
  const lngDelta = radiusMiles / milesPerDegLng;

  const minLat = centerLat - latDelta;
  const maxLat = centerLat + latDelta;
  const minLng = centerLng - lngDelta;
  const maxLng = centerLng + lngDelta;

  // Mapbox bbox format: minLng,minLat,maxLng,maxLat
  return `${minLng},${minLat},${maxLng},${maxLat}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ ok: false, error: "Method not allowed" });
  }

  const q = (req.query.q as string | undefined)?.trim();
  if (!q) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing query (q) parameter" });
  }

  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) {
    console.error("[mapbox] MAPBOX_ACCESS_TOKEN is not set");
    return res
      .status(500)
      .json({ ok: false, error: "Mapbox token not configured" });
  }

  // Optional center overrides from the client
  const nearLatRaw = req.query.nearLat as string | undefined;
  const nearLngRaw = req.query.nearLng as string | undefined;

  let nearLat = nearLatRaw ? Number(nearLatRaw) : DEFAULT_NEAR_LAT;
  let nearLng = nearLngRaw ? Number(nearLngRaw) : DEFAULT_NEAR_LNG;

  if (!Number.isFinite(nearLat)) nearLat = DEFAULT_NEAR_LAT;
  if (!Number.isFinite(nearLng)) nearLng = DEFAULT_NEAR_LNG;

  try {
    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        q
      )}.json`
    );

    url.searchParams.set("autocomplete", "true");
    url.searchParams.set("limit", "5");
    url.searchParams.set("country", "US");
    url.searchParams.set("proximity", `${nearLng},${nearLat}`);

    // Hard-restrict to ~400-mile box around the center
    url.searchParams.set(
      "bbox",
      makeBoundingBox(nearLat, nearLng, MAX_RADIUS_MILES)
    );

    url.searchParams.set("access_token", token);

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      const text = await resp.text();
      console.error("[mapbox] Bad response:", resp.status, text);
      return res
        .status(500)
        .json({ ok: false, error: "Failed to contact Mapbox" });
    }

    const data = await resp.json();

    const suggestions: Suggestion[] = (data.features || []).map((f: any) => {
      const context = (f.context || []) as any[];

      const getContext = (prefix: string) =>
        context.find(
          (c) => typeof c.id === "string" && c.id.startsWith(prefix)
        );

      const place = getContext("place.");
      const region = getContext("region.");
      const postcode = getContext("postcode.");

      const city =
        (place && place.text) ||
        (f.place_type?.includes("place") ? f.text : "") ||
        "";
      const state =
        (region && region.short_code?.split("-").pop()) ||
        (region && region.text) ||
        "";
      const zip = (postcode && postcode.text) || "";

      const streetNumber = f.address || "";
      const streetName = f.text || "";

      const center = f.center || [];
      const [lng, lat] =
        center.length === 2
          ? [Number(center[0]), Number(center[1])]
          : [null, null];

      return {
        id: f.id as string,
        label: f.place_name as string,
        streetNumber,
        streetName,
        city,
        state,
        zip,
        lat,
        lng,
      };
    });

    // Sort by distance so truly closest addresses show first
    const distanceFor = (s: Suggestion): number => {
      if (
        s.lat == null ||
        s.lng == null ||
        !Number.isFinite(s.lat) ||
        !Number.isFinite(s.lng)
      ) {
        return Number.POSITIVE_INFINITY;
      }
      return haversineMiles(nearLat, nearLng, s.lat, s.lng);
    };

    suggestions.sort((a, b) => distanceFor(a) - distanceFor(b));

    return res.status(200).json({ ok: true, suggestions });
  } catch (err) {
    console.error("[mapbox] Error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Unexpected Mapbox error" });
  }
}
