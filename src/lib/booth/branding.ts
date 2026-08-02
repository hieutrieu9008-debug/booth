/**
 * Single read helper for restaurant branding colors [Cx2-24]. brand_colors
 * (jsonb array, [0] = primary) is the canonical source once set; brand_color
 * (legacy single-color column) is the fallback for restaurants that predate
 * Plan V2 or whose brand_colors is empty/null. No I/O — pure.
 */
export type BrandColorsSource = { brand_color: string; brand_colors: unknown };

export function resolveBrandColors(restaurant: BrandColorsSource): string[] {
  if (Array.isArray(restaurant.brand_colors) && restaurant.brand_colors.length > 0) {
    return restaurant.brand_colors as string[];
  }
  return [restaurant.brand_color];
}

export function primaryBrandColor(restaurant: BrandColorsSource): string {
  return resolveBrandColors(restaurant)[0];
}
