// send-magic-link — Mise Recipes edge function
// Created by Joshua Bosen — All rights reserved.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://gua5d1an.github.io",
];

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

serve(async (req) => {
  const CORS = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { email, redirectTo } = await req.json();

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Admin client — uses service role key, injected automatically by Supabase
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Check allowlist server-side only — result never sent to client
    const { data: allowedUser } = await adminClient
      .from("allowed_emails")
      .select("email, role")
      .eq("email", cleanEmail)
      .single();

    if (allowedUser) {
      const safeRedirect = (
        typeof redirectTo === "string" &&
        ALLOWED_ORIGINS.some(o => redirectTo.startsWith(o))
      ) ? redirectTo : ALLOWED_ORIGINS[0];

      // signInWithOtp actually sends the magic link email
      const { error } = await adminClient.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          emailRedirectTo: safeRedirect,
          shouldCreateUser: true,
        },
      });

      if (error) {
        console.error("signInWithOtp error:", error.message);
      }
    }

    // Always return success — never reveal if email was on allowlist
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("send-magic-link error:", err);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
