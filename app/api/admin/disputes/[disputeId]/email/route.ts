// OATH: Clean replacement file
// FILE: app/api/admin/disputes/[disputeId]/email/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { AdminActionType, AdminTargetType, UserRole } from "@prisma/client";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

type SessionUser = {
  id?: string | null;
  role?: UserRole | string | null;
};

type RouteContext = {
  params: Promise<{
    disputeId: string;
  }>;
};

type Body = {
  to?: string;
  subject?: string;
  body?: string;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildHtmlEmail(args: { subject: string; body: string }) {
  const lines = args.body
    .split(/\r?\n/)
    .map((line) => line.trim());

  const htmlParts: string[] = [];
  let paragraphBuffer: string[] = [];

  function flushParagraph() {
    if (paragraphBuffer.length === 0) return;

    htmlParts.push(
      `<p style="margin:0 0 14px; font-size:14px; line-height:1.65; color:#334155;">${paragraphBuffer
        .map((line) => escapeHtml(line))
        .join("<br/>")}</p>`
    );

    paragraphBuffer = [];
  }

  for (const line of lines) {
    if (!line) {
      flushParagraph();
      continue;
    }

    paragraphBuffer.push(line);
  }

  flushParagraph();

  return `
    <div style="margin:0; padding:24px; background:#f8fafc;">
      <div style="max-width:680px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; overflow:hidden; font-family:Arial, Helvetica, sans-serif;">
        <div style="padding:20px 24px; background:#4f46e5; color:#ffffff;">
          <div style="font-size:13px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; opacity:0.95;">
            RideShare
          </div>
          <div style="margin-top:8px; font-size:24px; line-height:1.35; font-weight:700;">
            ${escapeHtml(args.subject)}
          </div>
        </div>

        <div style="padding:24px;">
          ${htmlParts.join("")}
        </div>

        <div style="padding:16px 24px; border-top:1px solid #e2e8f0; background:#f8fafc; font-size:12px; line-height:1.6; color:#64748b;">
          This message was sent from the RideShare admin dispute console.
        </div>
      </div>
    </div>
  `;
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as SessionUser | undefined;

    const adminId = typeof user?.id === "string" ? user.id.trim() : "";
    if (!adminId) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    if (user?.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { ok: false, error: "Only admins can send dispute emails." },
        { status: 403 }
      );
    }

    const { disputeId } = await context.params;
    const cleanDisputeId = typeof disputeId === "string" ? disputeId.trim() : "";

    if (!cleanDisputeId) {
      return NextResponse.json(
        { ok: false, error: "Missing disputeId" },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Body;

    const to = typeof body.to === "string" ? body.to.trim() : "";
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const messageBody = typeof body.body === "string" ? body.body.trim() : "";

    if (!to || !isValidEmail(to)) {
      return NextResponse.json(
        { ok: false, error: "Valid recipient email is required." },
        { status: 400 }
      );
    }

    if (!subject) {
      return NextResponse.json(
        { ok: false, error: "Subject is required." },
        { status: 400 }
      );
    }

    if (!messageBody) {
      return NextResponse.json(
        { ok: false, error: "Message body is required." },
        { status: 400 }
      );
    }

    const dispute = await prisma.dispute.findUnique({
      where: {
        id: cleanDisputeId,
      },
      select: {
        id: true,
        bookingId: true,
        rideId: true,
      },
    });

    if (!dispute) {
      return NextResponse.json(
        { ok: false, error: "Dispute not found." },
        { status: 404 }
      );
    }

    const html = buildHtmlEmail({
      subject,
      body: messageBody,
    });

    const sendResult = await sendEmail({
      to,
      subject,
      text: messageBody,
      html,
    });

    await prisma.adminAuditLog.create({
      data: {
        adminUserId: adminId,
        disputeId: dispute.id,
        actionType: AdminActionType.DISPUTE_MARKED_UNDER_REVIEW,
        targetType: AdminTargetType.DISPUTE,
        targetId: dispute.id,
        notes: `Email sent to ${to}\nSubject: ${subject}`,
        metadata: {
          disputeId: dispute.id,
          bookingId: dispute.bookingId,
          rideId: dispute.rideId,
          emailTo: to,
          emailSubject: subject,
          emailBody: messageBody,
          eventType: "DISPUTE_EMAIL_SENT",
          dryRun: sendResult.dryRun ?? false,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      sentTo: to,
      subject,
      dryRun: sendResult.dryRun ?? false,
    });
  } catch (error) {
    console.error("[POST /api/admin/disputes/[disputeId]/email] error:", error);

    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
