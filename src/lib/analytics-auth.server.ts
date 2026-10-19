// Supabase authentication for the analytics API, verified like
// src/integrations/supabase/auth-middleware.ts (getClaims on the bearer token).
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { ApiError, type Viewer } from "@/lib/analytics.server";

export async function authenticateSupabase(request: Request): Promise<Viewer> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.error("analytics: SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are not configured");
    throw new ApiError(503, "AUTH_UNAVAILABLE", "Authentication is not configured");
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) throw new ApiError(401, "UNAUTHORIZED", "A Supabase access token is required");

  const supabase = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired access token");

  let admin: Promise<boolean> | undefined;
  return {
    userId,
    // Same RLS-safe role check the database policies use (public.has_role).
    isAdmin: () =>
      (admin ??= Promise.resolve(
        supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      ).then(({ data: isAdmin, error: rpcError }) => {
        // Fail closed, but make a broken role check visible instead of a silent 403.
        if (rpcError) console.warn("analytics: has_role check failed", rpcError.message);
        return !rpcError && isAdmin === true;
      })),
  };
}
