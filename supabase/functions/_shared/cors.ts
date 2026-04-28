const explicitAllowedOrigins = new Set([
  "https://admin.paycheckmd.com",
  "https://id-preview--91cd514c-bc9c-4e4d-8b9d-4db90589140c.lovable.app",
  "https://physician-finances.lovable.app",
  "https://www.paycheckmd.com",
  "https://paycheckmd.com",
]);

function getAllowedOrigin(req: Request) {
  const origin = req.headers.get("Origin");
  if (!origin) return "https://admin.paycheckmd.com";
  if (explicitAllowedOrigins.has(origin)) return origin;

  try {
    const hostname = new URL(origin).hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".lovable.app")) {
      return origin;
    }
  } catch {
    return "https://admin.paycheckmd.com";
  }

  return "https://admin.paycheckmd.com";
}

export function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(req),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}
