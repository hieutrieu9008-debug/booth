import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setStaffSessionCookie } from "@/lib/booth/staff-session";
import { setInternalSessionCookie } from "@/app/internal/session";

/**
 * DEV ONLY — one-tap auth for local review/QA screenshots: signs in the
 * seeded demo owner and sets the staff + internal session cookies.
 * Hard 404 outside development; never deploy-reachable.
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    return new NextResponse(null, { status: 404 });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: "owner@demo.test",
    password: "booth-dev-1234",
  });

  // Seeded demo tenant + staff pin (supabase/seed.sql)
  await setStaffSessionCookie(
    "demo-kitchen",
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000201",
  );
  await setInternalSessionCookie();

  const to = new URL(req.url).searchParams.get("to") ?? "/dashboard/overview";
  return NextResponse.redirect(new URL(to, req.url), {
    headers: { "x-dev-login": error ? `owner-signin-failed: ${error.message}` : "ok" },
  });
}
