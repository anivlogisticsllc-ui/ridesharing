// pages/api/driver/service-cities.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";
import { UserRole } from "@prisma/client";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const role = (session.user as any).role as UserRole | undefined;
  if (role !== "DRIVER" && role !== "BOTH") {
    return res.status(403).json({ ok: false, error: "Not a driver" });
  }

  const userId = (session.user as any).id as string;

  if (req.method === "GET") {
    // Return current driver's profile + service cities
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
      include: { serviceCities: true },
    });

    return res.status(200).json({ ok: true, profile });
  }

  if (req.method === "POST") {
    const { cityName, cityLat, cityLng } = req.body as {
      cityName?: string;
      cityLat?: number;
      cityLng?: number;
    };

    if (!cityName) {
      return res
        .status(400)
        .json({ ok: false, error: "cityName is required" });
    }

    // TODO: later – compute real distance & enforce <= 10 miles between cities

    // Upsert profile
    const profile = await prisma.driverProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    try {
      const city = await prisma.driverServiceCity.create({
        data: {
          driverProfileId: profile.id,
          cityName,
          // for now, allow lat/lng to be optional – or pass 0 as placeholder
          cityLat: typeof cityLat === "number" ? cityLat : 0,
          cityLng: typeof cityLng === "number" ? cityLng : 0,
        },
      });

      return res.status(201).json({ ok: true, city });
    } catch (err: any) {
      // likely @@unique violation on (driverProfileId, cityName)
      return res.status(400).json({
        ok: false,
        error: err?.message || "Could not add service city",
      });
    }
  }

  if (req.method === "DELETE") {
    const { id } = req.body as { id?: string };

    if (!id) {
      return res.status(400).json({ ok: false, error: "id is required" });
    }

    // Ensure the city belongs to this driver's profile
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      return res.status(404).json({ ok: false, error: "Profile not found" });
    }

    await prisma.driverServiceCity.deleteMany({
      where: {
        id,
        driverProfileId: profile.id,
      },
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: "Method not allowed" });
}
