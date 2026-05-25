export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const wakeFallbackUrl = process.env.WAKE_FALLBACK_URL || "";
  const wakeFallbackToken = process.env.WAKE_FALLBACK_TOKEN || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" });
  }

  let normalizedUrl;
  try {
    const parsed = new URL(supabaseUrl);
    normalizedUrl = parsed.origin;
  } catch (error) {
    return res.status(500).json({ ok: false, error: "SUPABASE_URL inválida en Vercel." });
  }

  try {
    await fetch(`${normalizedUrl}/rest/v1/`, {
      method: "GET",
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: "No se pudo resolver/conectar al host de Supabase.",
      detail: error?.message || "fetch failed",
      url: normalizedUrl,
    });
  }

  return res.status(200).json({
    ok: true,
    url: normalizedUrl,
    anonKey: supabaseAnonKey,
    wakeFallbackUrl,
    wakeFallbackToken,
  });
}
