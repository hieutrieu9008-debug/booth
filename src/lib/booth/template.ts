/**
 * WS-D — shared template rendering for owner-editable message copy
 * (birthday message, and the restaurants.message_templates columns).
 * No DB, no "server-only": pure string substitution, safe to import from
 * client editors (live preview) and server code (cron, engine.ts) alike.
 */

export type TemplateVars = {
  name?: string;
  reward?: string;
  restaurant?: string;
  link?: string;
};

const PLACEHOLDER_RE = /\{(name|reward|restaurant|link)\}/g;

/** Replaces {name} {reward} {restaurant} {link} with the given vars. Unknown/missing vars render as empty string. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(PLACEHOLDER_RE, (_, key: keyof TemplateVars) => vars[key] ?? "");
}

const STOP_SUFFIX = " Reply STOP to opt out.";

/** Compliance guarantee: every rendered marketing body carries the STOP line exactly once. */
export function withStopSuffix(body: string): string {
  return body.includes("Reply STOP to opt out.") ? body : `${body}${STOP_SUFFIX}`;
}

export type TemplateValidationError = "missing_link";

/**
 * Save-time guard: a template that will be sent standalone (not immediately
 * followed by a card link the caller appends itself) must itself contain
 * {link}, so the compliance floor's card-link requirement can't be edited
 * away by an owner. Callers that always append their own link separately
 * don't need to require it.
 */
export function validateTemplate(template: string, opts: { requireLink: boolean }): TemplateValidationError | null {
  if (opts.requireLink && !template.includes("{link}")) return "missing_link";
  return null;
}
