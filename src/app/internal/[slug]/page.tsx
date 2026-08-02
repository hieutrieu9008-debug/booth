import { notFound } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { Card, Section } from "@/components/kit";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { resolveBrandColors } from "@/lib/booth/branding";
import { StaffPinForm } from "../staff-pin-form";
import { NumberCard } from "./number-card";
import { BrandingSection } from "./branding-section";
import { MenuImportSection } from "./menu-import";
import { SelfScanSection } from "./self-scan-section";

export default async function InternalTenantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = createSupabaseAdminClient();

  const { data: restaurant } = await admin.from("restaurants").select("*").eq("slug", slug).maybeSingle();
  if (!restaurant) notFound();

  const [{ count: memberCount }, { data: programs }, { count: eventCount }, { data: staffPins }] = await Promise.all([
    admin.from("members").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurant.id),
    admin
      .from("reward_programs")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .neq("type", "custom") // hidden per-member-offer bucket (Plan V3) — grant parentage only
      .order("created_at", { ascending: false }),
    admin.from("events").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurant.id),
    admin.from("staff_pins").select("id, label, active, created_at").eq("restaurant_id", restaurant.id).order("created_at", { ascending: false }),
  ]);

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const joinUrl = `${appUrl}/j/${slug}`;
  const staffUrl = `${appUrl}/s/${slug}`;
  const joinQr = await QRCode.toDataURL(joinUrl, { errorCorrectionLevel: "M", margin: 2, width: 320 });

  return (
    <Section bg="paper">
      <Link href="/internal" className="text-sm font-semibold underline">
        ← All tenants
      </Link>
      <h1 className="mt-2 font-display text-3xl font-extrabold">{restaurant.name}</h1>
      <p className="text-muted">
        {slug} · {restaurant.timezone} · {restaurant.currency}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card border>
          <p className="text-sm text-muted">Members</p>
          <p className="font-display text-2xl font-extrabold">{memberCount ?? 0}</p>
        </Card>
        <Card border>
          <p className="text-sm text-muted">Events</p>
          <p className="font-display text-2xl font-extrabold">{eventCount ?? 0}</p>
        </Card>
        <Card border>
          <p className="text-sm text-muted">Programs</p>
          <p className="font-display text-2xl font-extrabold">{(programs ?? []).length}</p>
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap gap-4">
        <Link href={`/j/${slug}`} className="text-sm font-semibold underline">
          /j/{slug} (join)
        </Link>
        <Link href={`/s/${slug}`} className="text-sm font-semibold underline">
          /s/{slug} (staff)
        </Link>
        <Link href={`/internal/${slug}/generate`} className="text-sm font-semibold underline">
          Setup generator →
        </Link>
      </div>

      <NumberCard restaurantId={restaurant.id} slug={slug} smsFrom={restaurant.sms_from} />

      <BrandingSection
        restaurantId={restaurant.id}
        slug={slug}
        logoUrl={restaurant.logo_url}
        backgroundUrl={restaurant.background_url}
        brandColors={resolveBrandColors(restaurant)}
      />

      <MenuImportSection restaurantId={restaurant.id} slug={slug} menuItems={restaurant.menu_items ?? []} />

      <SelfScanSection
        restaurantId={restaurant.id}
        slug={slug}
        visitMode={restaurant.visit_mode}
        selfScanToken={restaurant.self_scan_token}
        openHours={restaurant.open_hours}
      />

      <Card border shadow className="mt-6 w-fit">
        <p className="text-sm font-semibold">Join QR (quick testing)</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, next/image can't optimize it */}
        <img src={joinQr} alt="Join QR code" width={200} height={200} className="mt-2 h-[200px] w-[200px]" />
        <p className="mt-2 max-w-[200px] break-all text-xs text-muted">{joinUrl}</p>
      </Card>

      <Card border shadow className="mt-6">
        <h2 className="font-display text-xl font-bold">Programs</h2>
        <ul className="mt-3 space-y-3">
          {(programs ?? []).map((p) => (
            <li key={p.id} className="text-sm">
              <span className="font-semibold">{p.name}</span> — {p.type}
              {!p.active && " (inactive)"}
              <pre className="mt-1 overflow-x-auto rounded bg-cream p-2 text-xs">{JSON.stringify(p.config, null, 2)}</pre>
            </li>
          ))}
          {(programs ?? []).length === 0 && <p className="text-sm text-muted">No programs yet — use the setup generator.</p>}
        </ul>
      </Card>

      <Card border shadow className="mt-6 max-w-md">
        <h2 className="font-display text-xl font-bold">Staff PINs</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {(staffPins ?? []).map((sp) => (
            <li key={sp.id}>
              {sp.label}
              {!sp.active && " (inactive)"}
            </li>
          ))}
          {(staffPins ?? []).length === 0 && <li className="text-muted">No staff PINs yet.</li>}
        </ul>
        <StaffPinForm restaurantId={restaurant.id} slug={slug} />
      </Card>

      <p className="mt-8 text-xs text-muted">Staff loop: {staffUrl}</p>
    </Section>
  );
}
