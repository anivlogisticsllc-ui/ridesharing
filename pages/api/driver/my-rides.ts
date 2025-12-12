// pages/api/driver/my-rides.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "../../../lib/prisma";

type ApiResponse =
  | { ok: true; rides: any[] }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);

  const user = session?.user as
    | ({
        id?: string;
        name?: string | null;
        email?: string | null;
        image?: string | null;
      } & {
        role?: "RIDER" | "DRIVER" | "BOTH";
      })
    | undefined;

  if (!user?.id) {
    return res
      .status(401)
      .json({ ok: false, error: "Not authenticated" });
  }

  // Only drivers / BOTH
  const role = user.role;
  if (role !== "DRIVER" && role !== "BOTH") {
    return res
      .status(403)
      .json({ ok: false, error: "Not a driver" });
  }

  const userId = user.id;

  try {
    const rides = await prisma.ride.findMany({
      where: {
        driverId: userId,
      },
      orderBy: { departureTime: "asc" },
      include: {
        rider: {
          select: {
            name: true,
            publicId: true,
          },
        },
        bookings: {
          where: { status: "ACCEPTED" },
          select: {
            id: true,
            conversation: {
              select: { id: true },
            },
          },
        },
      },
    });

    const shaped = rides.map((r) => ({
      id: r.id,
      originCity: r.originCity,
      destinationCity: r.destinationCity,
      departureTime: r.departureTime.toISOString(),
      status: r.status,
      riderName: r.rider?.name ?? null,
      riderPublicId: (r.rider as any)?.publicId ?? null,
      bookingId: r.bookings[0]?.id ?? null,
      conversationId: r.bookings[0]?.conversation?.id ?? null,
    }));

    return res.status(200).json({ ok: true, rides: shaped });
  } catch (err) {
    console.error("Error loading driver rides:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Server error loading rides" });
  }
}
