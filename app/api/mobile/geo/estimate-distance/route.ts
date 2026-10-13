// app/api/mobile/geo/estimate-distance/route.ts

import { NextRequest, NextResponse } from "next/server";

const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;

type Coord = {
  lat: number;
  lng: number;
};

type ApiResponse =
  | {
      ok: true;
      miles: number;
      origin: Coord;
      destination: Coord;
    }
  | {
      ok: false;
      error: string;
    };

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:8081",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function withCors(status: number, payload: ApiResponse) {
  return NextResponse.json(payload, {
    status,
    headers: corsHeaders,
  });
}

async function geocodeAddress(address: string): Promise<Coord | null> {
  if (!MAPBOX_ACCESS_TOKEN) {
    return null;
  }

  const encoded = encodeURIComponent(address);

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json` +
    `?access_token=${MAPBOX_ACCESS_TOKEN}&limit=1&country=US`;

  const res = await fetch(url);

  if (!res.ok) {
    console.error(
      "[mobile/geocodeAddress] Mapbox error:",
      await res.text()
    );
    return null;
  }

  const data = await res.json();
  const feature = data.features?.[0];

  if (!feature || !feature.center) {
    return null;
  }

  const [lng, lat] = feature.center;

  if (typeof lat !== "number" || typeof lng !== "number") {
    return null;
  }

  return { lat, lng };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(req: NextRequest) {
  if (!MAPBOX_ACCESS_TOKEN) {
    return withCors(500, {
      ok: false,
      error: "Mapbox token not configured",
    });
  }

  try {
    const body = await req.json();

    const originAddress =
      typeof body.originAddress === "string"
        ? body.originAddress.trim()
        : "";

    const destinationAddress =
      typeof body.destinationAddress === "string"
        ? body.destinationAddress.trim()
        : "";

    if (!originAddress || !destinationAddress) {
      return withCors(400, {
        ok: false,
        error: "originAddress and destinationAddress are required",
      });
    }

    const [origin, destination] = await Promise.all([
      geocodeAddress(originAddress),
      geocodeAddress(destinationAddress),
    ]);

    if (!origin) {
      return withCors(400, {
        ok: false,
        error: "Could not geocode origin address",
      });
    }

    if (!destination) {
      return withCors(400, {
        ok: false,
        error: "Could not geocode destination address",
      });
    }

    const coords =
      `${origin.lng},${origin.lat};` +
      `${destination.lng},${destination.lat}`;

    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
      `?access_token=${MAPBOX_ACCESS_TOKEN}` +
      `&alternatives=false&overview=false&geometries=geojson`;

    const res = await fetch(url);

    if (!res.ok) {
      console.error(
        "[mobile/geo/estimate-distance] directions error:",
        await res.text()
      );

      return withCors(502, {
        ok: false,
        error: "Mapbox directions request failed",
      });
    }

    const data = await res.json();
    const route = data.routes?.[0];

    if (!route || typeof route.distance !== "number") {
      return withCors(400, {
        ok: false,
        error: "No route found between these addresses",
      });
    }

    const miles = route.distance / 1609.34;

    return withCors(200, {
      ok: true,
      miles,
      origin,
      destination,
    });
  } catch (err) {
    console.error("[mobile/geo/estimate-distance] error:", err);

    return withCors(500, {
      ok: false,
      error: "Internal server error",
    });
  }
}