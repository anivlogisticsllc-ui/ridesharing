import { NextRequest, NextResponse } from "next/server";

const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;

if (!MAPBOX_ACCESS_TOKEN) {
  console.warn("MAPBOX_ACCESS_TOKEN is not set.");
}

type Coord = { lat: number; lng: number };

type SuccessResponse = {
  ok: true;
  miles: number;
  origin: Coord;
  destination: Coord;
};

type ErrorResponse = {
  ok: false;
  error: string;
};

async function geocodeAddress(address: string): Promise<Coord | null> {
  const encoded = encodeURIComponent(address);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_ACCESS_TOKEN}&limit=1&country=US`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error("[geocodeAddress] Mapbox error:", await res.text());
    return null;
  }

  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature || !feature.center) return null;

  const [lng, lat] = feature.center;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  return { lat, lng };
}

export async function POST(req: NextRequest) {
  if (!MAPBOX_ACCESS_TOKEN) {
    return NextResponse.json<ErrorResponse>(
      { ok: false, error: "Mapbox token not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const originAddress = (body.originAddress || "").trim();
    const destinationAddress = (body.destinationAddress || "").trim();

    if (!originAddress || !destinationAddress) {
      return NextResponse.json<ErrorResponse>(
        { ok: false, error: "originAddress and destinationAddress are required" },
        { status: 400 }
      );
    }

    const [origin, destination] = await Promise.all([
      geocodeAddress(originAddress),
      geocodeAddress(destinationAddress),
    ]);

    if (!origin) {
      return NextResponse.json<ErrorResponse>({
        ok: false,
        error: "Could not geocode origin address",
      });
    }

    if (!destination) {
      return NextResponse.json<ErrorResponse>({
        ok: false,
        error: "Could not geocode destination address",
      });
    }

    const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?access_token=${MAPBOX_ACCESS_TOKEN}&alternatives=false&overview=false&geometries=geojson`;

    const res = await fetch(url);
    if (!res.ok) {
      console.error("[/api/geo/estimate-distance] directions error:", await res.text());
      return NextResponse.json<ErrorResponse>(
        { ok: false, error: "Mapbox directions request failed" },
        { status: 502 }
      );
    }

    const data = await res.json();
    const route = data.routes?.[0];

    if (!route || typeof route.distance !== "number") {
      return NextResponse.json<ErrorResponse>({
        ok: false,
        error: "No route found between these addresses",
      });
    }

    const distanceMeters: number = route.distance;
    const miles = distanceMeters / 1609.34;

    const payload: SuccessResponse = {
      ok: true,
      miles,
      origin,
      destination,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error("[/api/geo/estimate-distance] error:", err);
    return NextResponse.json<ErrorResponse>(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
