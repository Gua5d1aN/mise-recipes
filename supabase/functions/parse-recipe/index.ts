import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { text } = await req.json();

    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "No text provided" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_KEY) {
      return new Response(JSON.stringify({ error: "API key not configured" }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are a recipe parser. Extract the recipe data from the following text and return ONLY a valid JSON object — no markdown, no explanation, no backticks.

The JSON must follow this exact schema:
{
  "name": "string — recipe name",
  "category": "string — one of: Entrée, Main, Dessert, Sauce, Base, Snack, Bread, Pastry, Beverage, Other",
  "yield_amount": "string — number or range e.g. '10' or '8-10'",
  "yield_unit": "string — e.g. 'portions', 'serves', 'kg', 'litres'",
  "ingredients": [
    { "name": "string", "amount": "string", "unit": "string" }
  ],
  "method": ["string — step 1", "string — step 2"]
}

Rules:
- Separate ingredient name from amount and unit. e.g. '200g butter' → name:'butter', amount:'200', unit:'g'
- If a field cannot be determined, use an empty string.
- method must be an array of strings, one per step.
- Do not include any text outside the JSON object.

Recipe text:
${text.slice(0, 8000)}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: "Anthropic error", detail: err }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text || "";

    // Parse and validate the JSON
    let recipe;
    try {
      recipe = JSON.parse(raw.trim());
    } catch {
      // Try to extract JSON if Claude wrapped it in anything
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        recipe = JSON.parse(match[0]);
      } else {
        throw new Error("Could not parse recipe JSON from response");
      }
    }

    return new Response(JSON.stringify({ recipe }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Unexpected error" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
