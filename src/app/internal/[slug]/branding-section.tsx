"use client";

import { useActionState, useState } from "react";
import { Button, Card } from "@/components/kit";
import {
  uploadLogoAction,
  uploadBackgroundAction,
  saveBrandColorsAction,
  type BrandingUploadState,
  type BrandColorsState,
} from "./branding-actions";

const uploadIdle: BrandingUploadState = { status: "idle" };
const colorsIdle: BrandColorsState = { status: "idle" };

function UploadField({
  label,
  fieldName,
  currentUrl,
  action,
}: {
  label: string;
  fieldName: string;
  currentUrl: string | null;
  action: (prev: BrandingUploadState, formData: FormData) => Promise<BrandingUploadState>;
}) {
  const [state, formAction, pending] = useActionState(action, uploadIdle);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-ink">{label}</p>
      {currentUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- storage public URL, not optimizable by next/image here
        <img src={currentUrl} alt={`Current ${label.toLowerCase()}`} className="h-24 w-24 rounded-card border-2 border-line object-cover" />
      ) : (
        <p className="text-sm text-muted">No {label.toLowerCase()} uploaded yet.</p>
      )}
      <input
        type="file"
        name={fieldName}
        accept="image/png,image/jpeg,image/webp"
        className="text-sm text-ink file:mr-3 file:rounded-button file:border-2 file:border-ink file:bg-paper file:px-3 file:py-1.5 file:text-sm file:font-semibold"
      />
      <Button type="submit" variant="secondary" disabled={pending} className="w-fit">
        {pending ? "Uploading…" : `Upload ${label.toLowerCase()}`}
      </Button>
      {state.status === "error" && (
        <p className="text-sm font-semibold text-coral-dark" role="alert">
          {state.error}
        </p>
      )}
      {state.status === "success" && <p className="text-sm font-semibold text-ink">Uploaded.</p>}
      <p className="text-xs text-muted">PNG, JPEG, or WEBP. Up to 5MB.</p>
    </form>
  );
}

function BrandColorsEditor({
  restaurantId,
  slug,
  initialColors,
}: {
  restaurantId: string;
  slug: string;
  initialColors: string[];
}) {
  const [colors, setColors] = useState<string[]>(initialColors.length > 0 ? initialColors : ["#F26649"]);
  const [state, setState] = useState<BrandColorsState>(colorsIdle);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const result = await saveBrandColorsAction(restaurantId, slug, colors);
      setState(result);
    } catch (caught) {
      setState({ status: "error", error: caught instanceof Error ? caught.message : "Save failed — try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-ink">Brand colours</p>
      <p className="text-xs text-muted">First colour is primary — mirrored to the legacy brand_color field too.</p>
      <div className="flex flex-col gap-2">
        {colors.map((color, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="h-9 w-9 shrink-0 rounded-button border-2 border-line" style={{ backgroundColor: HEX_RE.test(color) ? color : "transparent" }} />
            <input
              type="text"
              value={color}
              onChange={(e) => {
                const next = [...colors];
                next[i] = e.target.value;
                setColors(next);
              }}
              placeholder="#F26649"
              className="min-h-9 w-32 rounded-button border-2 border-line bg-cream px-3 text-sm text-ink"
            />
            {i === 0 && <span className="text-xs font-semibold text-muted">primary</span>}
            {colors.length > 1 && (
              <Button type="button" variant="ghost" onClick={() => setColors(colors.filter((_, j) => j !== i))}>
                Remove
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" className="w-fit" onClick={() => setColors([...colors, "#"])}>
          Add colour
        </Button>
        <Button type="button" className="w-fit" disabled={saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save colours"}
        </Button>
      </div>
      {state.status === "error" && (
        <p className="text-sm font-semibold text-coral-dark" role="alert">
          {state.error}
        </p>
      )}
      {state.status === "success" && <p className="text-sm font-semibold text-ink">Saved.</p>}
    </div>
  );
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function BrandingSection({
  restaurantId,
  slug,
  logoUrl,
  backgroundUrl,
  brandColors,
}: {
  restaurantId: string;
  slug: string;
  logoUrl: string | null;
  backgroundUrl: string | null;
  brandColors: string[];
}) {
  return (
    <Card border shadow className="mt-6">
      <h2 className="font-display text-xl font-bold">Branding</h2>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <UploadField label="Logo" fieldName="logo" currentUrl={logoUrl} action={(p, f) => uploadLogoAction(restaurantId, slug, p, f)} />
        <UploadField
          label="Background"
          fieldName="background"
          currentUrl={backgroundUrl}
          action={(p, f) => uploadBackgroundAction(restaurantId, slug, p, f)}
        />
      </div>
      <div className="mt-6">
        <BrandColorsEditor restaurantId={restaurantId} slug={slug} initialColors={brandColors} />
      </div>
    </Card>
  );
}
