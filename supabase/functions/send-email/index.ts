import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import nodemailer from "npm:nodemailer@6.9.14";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type EmailAttachment = {
  filename?: string;
  content?: string;
  contentType?: string;
  encoding?: string;
};

type EmailBody = {
  to?: string;
  subject?: string;
  html?: string;
  text?: string;
  from?: string;
  nombre?: string;
  fototipo?: string;
  tipoFototipo?: string;
  fototipo_de_piel?: string;
  recomendacion?: string;
  recommendation?: string;
  attachments?: EmailAttachment[];
};

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildFallbackHtml(body: EmailBody) {
  const nombre = escapeHtml(body.nombre || "Voluntario");
  const fototipo = escapeHtml(body.fototipo || body.tipoFototipo || body.fototipo_de_piel || "No disponible");
  const recomendacion = escapeHtml(body.recomendacion || body.recommendation || "");

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#0f172a">
      <h2 style="margin:0 0 12px">Hola, ${nombre}</h2>
      <p>Tu resultado del fototipo de piel es: <strong>${fototipo}</strong>.</p>
      ${recomendacion ? `<p>${recomendacion}</p>` : ""}
      <p style="margin-top:16px">Gracias por participar en Proyecto Espectral.</p>
    </div>`;
}

function normalizeAttachments(attachments: EmailAttachment[] = []) {
  return attachments
    .filter((item) => item?.filename && item?.content)
    .map((item) => ({
      filename: item.filename,
      content: item.content,
      contentType: item.contentType || "application/octet-stream",
      encoding: item.encoding || "base64",
    }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const gmailUser = Deno.env.get("GMAIL_USER") || "";
  const gmailAppPassword = Deno.env.get("GMAIL_APP_PASSWORD") || "";
  if (!gmailUser || !gmailAppPassword) {
    return jsonResponse(500, { error: "Missing GMAIL_USER or GMAIL_APP_PASSWORD secrets" });
  }

  const body = (await req.json()) as EmailBody;
  const to = String(body.to || "").trim();
  if (!to) {
    return jsonResponse(400, { error: "Missing recipient: to" });
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser,
      pass: gmailAppPassword,
    },
  });

  const info = await transporter.sendMail({
    from: body.from || `Proyecto Espectral <${gmailUser}>`,
    to,
    subject: body.subject || "Proyecto Espectral",
    text: body.text,
    html: body.html || buildFallbackHtml(body),
    attachments: normalizeAttachments(body.attachments),
  });

  return jsonResponse(200, {
    ok: true,
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
  });
});
