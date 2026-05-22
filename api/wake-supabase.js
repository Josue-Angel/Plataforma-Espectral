export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" });
  }

  try {
    const url = `${supabaseUrl}/rest/v1/perfiles?select=id&limit=1`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(503).json({
        ok: false,
        error: `Supabase upstream error (${response.status})`,
        upstreamStatus: response.status,
        detail: text.slice(0, 250),
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error?.message || "Wake request failed",
      detail: "No se pudo alcanzar Supabase desde la función serverless.",
    });
  }
}
