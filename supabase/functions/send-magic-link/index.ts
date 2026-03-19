import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://gua5d1an.github.io",
  // Add additional property domains here as you deploy them
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

// Always returns { success: true } regardless of outcome — never reveal
// whether an email is on the allowlist (prevents enumeration)
function ok(cors: Record<string, string>) {
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const CORS = corsHeaders(req);

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const { email, redirectTo } = await req.json();

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return ok(CORS); // Don't reveal validation errors
    }

    const cleanEmail = email.trim().toLowerCase();

    // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
    // into all Supabase edge functions — no manual secrets needed for these
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Check allowlist — uses service role, result never sent to client
    const { data: allowed } = await adminClient
      .from("allowed_emails")
      .select("email, role")
      .eq("email", cleanEmail)
      .single();

    if (allowed) {
      // Valid email — send magic link via Supabase OTP
      // Using the auth API directly so Supabase handles email delivery
      const safeRedirect = (
        typeof redirectTo === "string" &&
        ALLOWED_ORIGINS.some(o => redirectTo.startsWith(o))
      ) ? redirectTo : ALLOWED_ORIGINS[0];

      await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: cleanEmail,
        options: { redirectTo: safeRedirect },
      });

      // generateLink creates the user if needed and returns the link,
      // but doesn't send the email. Use signInWithOtp to trigger delivery.
      await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          email: cleanEmail,
          create_user: true,
          data: { role: allowed.role },
          options: { redirectTo: safeRedirect },
        }),
      });
    }

    // Always return success — don't reveal if email was found or not
    return ok(CORS);

  } catch (err) {
    console.error("send-magic-link error:", err);
    return ok(CORS); // Still return success to prevent enumeration
  }
});
