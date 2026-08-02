import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireCronAuth } from "../_lib";

export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from("reward_grants")
    .update({ state: "expired" })
    .eq("state", "earned")
    .lt("expires_at", nowIso)
    .select("id");
  if (error) throw error;

  return Response.json({ expired: (data ?? []).length });
}
