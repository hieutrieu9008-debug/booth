import QRCode from "qrcode";
import Link from "next/link";
import { requireOwnerRestaurant } from "@/lib/owner";
import { Card, Section } from "@/components/kit";
import { getOwnerRestaurantFull } from "@/lib/booth/dashboard-data";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { parseProgramConfig } from "@/lib/booth/programs";
import { primaryBrandColor } from "@/lib/booth/branding";
import type { RewardProgram } from "@/lib/booth/types";

async function toQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 2, color: { dark: "#20231F", light: "#FFFFFF" }, width: 800 });
}

/** Missing/blank NEXT_PUBLIC_APP_URL -> null so callers render an owner-safe error card instead of a QR pointing at a relative URL (Codex #21). */
export function signsBaseUrl(raw: string | undefined): string | null {
  const trimmed = (raw ?? "").trim().replace(/\/$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

export default async function SignsPage() {
  const owner = await requireOwnerRestaurant();
  const restaurant = await getOwnerRestaurantFull(owner.id);

  const baseUrl = signsBaseUrl(process.env.NEXT_PUBLIC_APP_URL);
  if (!baseUrl) {
    return (
      <Section bg="paper">
        <Card border className="mx-auto max-w-md text-center">
          <h1 className="font-display text-2xl font-extrabold">Signs unavailable</h1>
          <p className="mt-3 text-base text-muted">Signs need the app&apos;s public address configured — contact support.</p>
        </Card>
      </Section>
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: welcomePrograms } = await admin
    .from("reward_programs")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .eq("type", "welcome")
    .eq("active", true)
    .limit(1);
  const welcomeProgram = (welcomePrograms as RewardProgram[] | null)?.[0];
  const welcomeReward = welcomeProgram ? (parseProgramConfig(welcomeProgram.type, welcomeProgram.config) as { config: { reward: string } }).config.reward : null;

  // Signs branding uses the same resolved-branding model as the diner pages
  // (Codex #22) — brand_colors isn't in getOwnerRestaurantFull's projection,
  // so it's fetched here rather than widening that shared query's scope.
  const { data: brandRow } = await admin
    .from("restaurants")
    .select("brand_color, brand_colors")
    .eq("id", restaurant.id)
    .single();
  const brandColor = brandRow ? primaryBrandColor(brandRow) : restaurant.brand_color;

  const joinUrl = `${baseUrl}/j/${restaurant.slug}`;
  const joinQr = await toQrDataUrl(joinUrl);

  // WS-B item 3: the sign QR must encode the /v URL (phone cameras open it
  // directly) — the raw bl:v: payload stays staff-scanner-only.
  const showSelfScan = restaurant.visit_mode !== "staff_scan" && !!restaurant.self_scan_token;
  const checkinQr = showSelfScan ? await toQrDataUrl(`${baseUrl}/v/${restaurant.slug}?t=${restaurant.self_scan_token}`) : null;

  return (
    <Section bg="paper">
      <div className="print:hidden">
        <h1 className="font-display text-3xl font-extrabold">Signs</h1>
        <p className="mt-2 text-base text-muted">
          Print these at the till or the door. Use your browser&apos;s Print (Ctrl/Cmd+P) for a ready-to-cut A5/A6
          sheet, or download the QR alone as a PNG.
        </p>
      </div>

      <div className="mt-8 grid gap-8 sm:grid-cols-2 print:grid-cols-1 print:gap-0">
        <SignCard
          restaurantName={restaurant.name}
          brandColor={brandColor}
          headline={welcomeReward ? `Scan for ${welcomeReward}` : "Scan to join our rewards"}
          qrDataUrl={joinQr}
          qrAlt="QR code to join the rewards programme"
          downloadName="booth-join-qr"
        />

        {showSelfScan && checkinQr && (
          <SignCard
            restaurantName={restaurant.name}
            brandColor={brandColor}
            headline="Already a member? Scan to check in"
            qrDataUrl={checkinQr}
            qrAlt="QR code to check in as an existing member"
            downloadName="booth-checkin-qr"
          />
        )}
      </div>

      {welcomeReward && (
        <p className="mt-4 text-sm text-muted print:hidden">
          From your Welcome reward →{" "}
          <Link href="/dashboard/rewards" className="font-semibold text-coral-dark underline">
            edit
          </Link>
        </p>
      )}

      <style>{`
        @media print {
          @page { size: A5; margin: 10mm; }
          header, nav { display: none !important; }
        }
      `}</style>
    </Section>
  );
}

function SignCard({
  restaurantName,
  brandColor,
  headline,
  qrDataUrl,
  qrAlt,
  downloadName,
}: {
  restaurantName: string;
  brandColor: string;
  headline: string;
  qrDataUrl: string;
  qrAlt: string;
  downloadName: string;
}) {
  return (
    <Card shadow border className="break-inside-avoid text-center print:shadow-none">
      <div className="flex items-center justify-center gap-2">
        <p className="font-display text-lg font-bold">{restaurantName}</p>
        <span aria-hidden className="h-2.5 w-2.5 rounded-full border border-ink" style={{ backgroundColor: brandColor }} />
      </div>
      <h2 className="mt-4 font-display text-2xl font-extrabold">{headline}</h2>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qrDataUrl}
        alt={qrAlt}
        className="mx-auto mt-6 block"
        style={{ width: "40mm", height: "40mm", minWidth: "3cm", minHeight: "3cm" }}
      />
      <p className="mt-6 text-xs font-semibold text-muted">Powered by Booth</p>
      <a
        href={qrDataUrl}
        download={`${downloadName}.png`}
        className="mt-4 inline-block text-sm font-semibold text-coral-dark underline underline-offset-2 print:hidden"
      >
        Download QR as PNG
      </a>
    </Card>
  );
}
