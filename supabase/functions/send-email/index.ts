import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import nodemailer from "npm:nodemailer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type EmailAttachment = {
  filename?: string;
  content?: string;
  contentType?: string;
  encoding?: string;
};

type EmailBody = {
  to?: string;
  fototipo?: string;
  tipoFototipo?: string;
  fototipo_de_piel?: string;
  recomendacion?: string;
  recommendation?: string;
  nombre?: string;
  subject?: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
  themePrimary?: string;
  themeAccent?: string;
  themeDark?: string;
  themeBg?: string;
  themeSoft?: string;
  themeLine?: string;
};

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
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

function isHexColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function getTheme(body: EmailBody) {
  return {
    bg: isHexColor(body.themeBg) ? body.themeBg : "#f0f4f8",
    dark: isHexColor(body.themeDark) ? body.themeDark : "#0d2a4d",
    accent: isHexColor(body.themeAccent) ? body.themeAccent : "#3182ce",
    soft: isHexColor(body.themeSoft) ? body.themeSoft : "#ebf4ff",
    line: isHexColor(body.themeLine) ? body.themeLine : "#e2e8f0",
  };
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as EmailBody;
    const {
      to,
      nombre,
      subject,
      html: customHtml,
      text,
      attachments = [],
    } = body;

    const gmailUser = Deno.env.get("GMAIL_USER");
    const gmailAppPassword = Deno.env.get("GMAIL_APP_PASSWORD");
    if (!gmailUser || !gmailAppPassword) {
      throw new Error("Faltan los secretos GMAIL_USER o GMAIL_APP_PASSWORD");
    }
    if (!to) throw new Error("Falta el destinatario del correo");

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailUser,
        pass: gmailAppPassword,
      },
    });

    const theme = getTheme(body);
    const fototipo = escapeHtml(body.fototipo || body.tipoFototipo || body.fototipo_de_piel || "No disponible");
    const recomendacion = escapeHtml(body.recomendacion || body.recommendation || "Sin recomendación disponible");
    const safeName = escapeHtml(nombre || "Usuario");

    let finalHtml = "";
    let finalSubject = subject || "Notificación de Proyecto Espectral";

    if (customHtml) {
      finalHtml = customHtml;
    } else {
      finalSubject = subject || "🔬 Resultado de tu Fototipo de Piel";
      finalHtml = `
        <div style="background-color: ${theme.bg}; padding: 40px 10px; font-family: sans-serif;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid ${theme.line};">
            <div style="background-color: ${theme.dark}; padding: 20px; color: white; font-weight: bold; font-size: 20px;">
              Proyecto Espectral
            </div>
            <div style="padding: 40px 30px; line-height: 1.6;">
              <h1 style="color: #1a202c; font-size: 22px;">Hola ${safeName},</h1>
              <p style="color: #4a5568;">Ya hemos procesado tu información. Aquí tienes los detalles de tu análisis:</p>

              <div style="background-color: ${theme.soft}; border-left: 5px solid ${theme.accent}; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0; font-size: 18px; color: #2c5282;">
                  <strong>Fototipo de Piel:</strong> ${fototipo}
                </p>
                <p style="margin: 10px 0 0 0; font-size: 15px; color: #4a5568;">
                  ${recomendacion}
                </p>
              </div>

              <p style="font-size: 12px; color: #a0aec0; border-top: 1px solid #edf2f7; padding-top: 20px;">
                Laboratorio de Óptica Biomédica UPT
              </p>
            </div>
          </div>
        </div>
      `;
    }

    const mailOptions = {
      from: `"Proyecto Espectral" <${gmailUser}>`,
      to,
      subject: finalSubject,
      html: finalHtml,
      text,
      attachments: normalizeAttachments(attachments),
    };

    await transporter.sendMail(mailOptions);

    return jsonResponse(200, { success: true });
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : String(error) });
  }
});
