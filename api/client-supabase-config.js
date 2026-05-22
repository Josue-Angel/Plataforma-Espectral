export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" });
  }

  return res.status(200).json({ ok: true, url: supabaseUrl, anonKey: supabaseAnonKey });
}
