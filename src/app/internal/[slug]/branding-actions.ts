"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const ALLOWED_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_BYTES = 5 * 1024 * 1024;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export type BrandingUploadState = { status: "idle" | "error" | "success"; error?: string };

async function uploadBrandingAsset(
  restaurantId: string,
  slug: string,
  kind: "logo" | "background",
  file: File
): Promise<BrandingUploadState> {
  if (!file || file.size === 0) return { status: "error", error: "Choose a file first." };
  const ext = ALLOWED_MIME[file.type];
  if (!ext) return { status: "error", error: "Only PNG, JPEG, or WEBP images are allowed." };
  if (file.size > MAX_BYTES) return { status: "error", error: "File must be 5MB or smaller." };

  const admin = createSupabaseAdminClient();
  const key = `${restaurantId}/${kind}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage.from("branding").upload(key, bytes, {
    contentType: file.type,
    upsert: true,
  });
  if (uploadError) return { status: "error", error: uploadError.message };

  const { data: publicUrlData } = admin.storage.from("branding").getPublicUrl(key);
  const column = kind === "logo" ? "logo_url" : "background_url";
  const { error: updateError } = await admin
    .from("restaurants")
    .update({ [column]: publicUrlData.publicUrl })
    .eq("id", restaurantId);
  if (updateError) return { status: "error", error: updateError.message };

  revalidatePath(`/internal/${slug}`);
  return { status: "success" };
}

export async function uploadLogoAction(
  restaurantId: string,
  slug: string,
  _prevState: BrandingUploadState,
  formData: FormData
): Promise<BrandingUploadState> {
  const file = formData.get("logo");
  if (!(file instanceof File)) return { status: "error", error: "Choose a file first." };
  return uploadBrandingAsset(restaurantId, slug, "logo", file);
}

export async function uploadBackgroundAction(
  restaurantId: string,
  slug: string,
  _prevState: BrandingUploadState,
  formData: FormData
): Promise<BrandingUploadState> {
  const file = formData.get("background");
  if (!(file instanceof File)) return { status: "error", error: "Choose a file first." };
  return uploadBrandingAsset(restaurantId, slug, "background", file);
}

export type BrandColorsState = { status: "idle" | "error" | "success"; error?: string };

/** Writes brand_colors AND mirrors [0] into the legacy brand_color column [WS1 Cx2-24]. */
export async function saveBrandColorsAction(
  restaurantId: string,
  slug: string,
  colors: string[]
): Promise<BrandColorsState> {
  const cleaned = colors.map((c) => c.trim()).filter((c) => c.length > 0);
  if (cleaned.length === 0) return { status: "error", error: "Add at least one colour." };
  const invalid = cleaned.find((c) => !HEX_RE.test(c));
  if (invalid) return { status: "error", error: `"${invalid}" isn't a valid hex colour (e.g. #F26649).` };

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("restaurants")
    .update({ brand_colors: cleaned, brand_color: cleaned[0] })
    .eq("id", restaurantId);
  if (error) return { status: "error", error: error.message };

  revalidatePath(`/internal/${slug}`);
  return { status: "success" };
}
