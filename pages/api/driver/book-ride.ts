// ✅ Driver verification gate
const profile = await prisma.driverProfile.findUnique({
  where: { userId },
  select: { verificationStatus: true },
});

if (!profile) {
  return res.status(403).json({
    ok: false,
    error: "Driver profile missing. Complete driver setup first.",
  });
}

if (profile.verificationStatus !== "APPROVED") {
  return res.status(403).json({
    ok: false,
    error: `Driver verification required to book rides. Status: ${profile.verificationStatus}`,
  });
}
