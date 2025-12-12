// lib/geocoding.ts
const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;

if (!MAPBOX_TOKEN) {
  // Don't throw at import time in Next.js; just log.
  console.warn(
    "[geocoding] MAPBOX_ACCESS_TOKEN is not set. Geocoding will not work."
  );
}

export type GeocodeResult = {
  lat: number;
  lng: number;
  normalizedAddress: string;
};

async function mapboxFetch<T>(url: string): Promise<T> {
  if (!MAPBOX_TOKEN) {
    throw new Error("MAPBOX_ACCESS_TOKEN is not configured");
  }

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Mapbox request failed (${res.status}): ${text || "Unknown error"}`
    );
  }

  return (await res.json()) as T;
}

/**
 * Geocode a free-form address into lat/lng + normalized text.
 */
export async function geocodeAddress(
  address: string
): Promise<GeocodeResult | null> {
  if (!address.trim()) return null;

  const url =
    "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
    encodeURIComponent(address) +
    `.json?access_token=${MAPBOX_TOKEN}&limit=1`;

  type MapboxGeocodeResponse = {
    features: Array<{
      center: [number, number]; // [lng, lat]
      place_name: string;
    }>;
  };

  const data = await mapboxFetch<MapboxGeocodeResponse>(url);

  const feature = data.features?.[0];
  if (!feature) return null;

  const [lng, lat] = feature.center;

  return {
    lat,
    lng,
    normalizedAddress: feature.place_name,
  };
}

/**
 * Given two addresses, geocode both and estimate *driving* distance in miles.
 * Returns null if either address can't be resolved.
 */
export async function estimateDrivingDistanceMiles(
  originAddress: string,
  destinationAddress: string
): Promise<
  | {
      miles: number;
      origin: GeocodeResult;
      destination: GeocodeResult;
    }
  | null
> {
  const origin = await geocodeAddress(originAddress);
  const destination = await geocodeAddress(destinationAddress);

  if (!origin || !destination) return null;

  const coordsPart = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;

  const url =
    "https://api.mapbox.com/directions/v5/mapbox/driving/" +
    coordsPart +
    `?access_token=${MAPBOX_TOKEN}&overview=false&annotations=distance`;

  type MapboxDirectionsResponse = {
    routes: Array<{
      distance: number; // meters
    }>;
  };

  const data = await mapboxFetch<MapboxDirectionsResponse>(url);

  const route = data.routes?.[0];
  if (!route) return null;

  const miles = route.distance * 0.000621371; // meters -> miles

  return {
    miles,
    origin,
    destination,
  };
}
