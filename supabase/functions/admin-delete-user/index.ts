import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: requesterData, error: requesterError } = await userClient.auth.getUser();
  if (requesterError || !requesterData.user) {
    return new Response(JSON.stringify({ error: "Sesión inválida" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: requesterProfile, error: profileError } = await adminClient
    .from("perfiles")
    .select("role")
    .eq("id", requesterData.user.id)
    .maybeSingle();

  const requesterRole = String(requesterProfile?.role || "").toLowerCase();
  if (profileError || !["admin", "desarrollador"].includes(requesterRole)) {
    return new Response(JSON.stringify({ error: "No tienes permisos para eliminar usuarios" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const userId = String(body?.userId || "").trim();
  if (!userId) {
    return new Response(JSON.stringify({ error: "Falta userId" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (userId === requesterData.user.id) {
    return new Response(JSON.stringify({ error: "No puedes eliminar tu propia cuenta desde este panel" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await adminClient.from("voluntarios").delete().eq("user_id", userId);
  await adminClient.from("perfiles").delete().eq("id", userId);
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
