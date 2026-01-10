// app/api/geo/suggest/route.ts
import { NextRequest, NextResponse } from "next/server";

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

// Default center: SF Bay Area
const DEFAULT_NEAR_LAT = 37.7749;
const DEFAULT_NEAR_LNG = -122.4194;
const MAX_RADIUS_MILES = 400;

// Haversine distance in miles
function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8;
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

// Build bbox: "minLng,minLat,maxLng,maxLat"
function makeBoundingBox(
  centerLat: number,
  centerLng: number,
  radiusMiles: number
) {
  const latDelta = radiusMiles / 69; // ~69 miles per degree lat

  const latRad = (centerLat * Math.PI) / 180;
  const milesPerDegLng = 69 * Math.cos(latRad) || 1;
  const lngDelta = radiusMiles / milesPerDegLng;

  const minLat = centerLat - latDelta;
  const maxLat = centerLat + latDelta;
  const minLng = centerLng - lngDelta;
  const maxLng = centerLng + lngDelta;

  return `${minLng},${minLat},${maxLng},${maxLat}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const q = searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json<ApiResponse>(
      { ok: false, error: "Missing query (q) parameter" },
      { status: 400 }
    );
  }

  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) {
    console.error("[geo/suggest] MAPBOX_ACCESS_TOKEN is not set");
    return NextResponse.json<ApiResponse>(
      { ok: false, error: "Mapbox token not configured" },
      { status: 500 }
    );
  }

  const nearLatRaw = searchParams.get("nearLat") ?? undefined;
  const nearLngRaw = searchParams.get("nearLng") ?? undefined;

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
    url.searchParams.set(
      "bbox",
      makeBoundingBox(nearLat, nearLng, MAX_RADIUS_MILES)
    );
    url.searchParams.set("access_token", token);

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      const text = await resp.text();
      console.error("[geo/suggest] Bad response:", resp.status, text);
      return NextResponse.json<ApiResponse>(
        { ok: false, error: "Failed to contact Mapbox" },
        { status: 500 }
      );
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

    return NextResponse.json<ApiResponse>({
      ok: true,
      suggestions,
    });
  } catch (err) {
    console.error("[geo/suggest] Error:", err);
    return NextResponse.json<ApiResponse>(
      { ok: false, error: "Unexpected Mapbox error" },
      { status: 500 }
    );
  }
}
