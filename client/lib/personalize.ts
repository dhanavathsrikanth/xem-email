/**
 * Pure personalization helpers used by the Cold Email editor and its live preview.
 *
 * Token grammar (case-insensitive, whitespace tolerant):
 *   {{ name }}   {{first_name}}   { company }   {name}
 *
 * Unknown / empty tokens are left as-is so the preview can highlight them
 * instead of silently swallowing a typo.
 *
 * Inputs are plain strings; the caller decides whether to render HTML escape
 * (we escape user-controlled field values defensively below).
 */

export const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}|\{\s*([a-zA-Z0-9_]+)\s*\}/g;

export const BUILT_IN_FIELDS = [
  "first_name",
  "last_name",
  "name",
  "full_name",
  "email",
  "company",
  "title",
  "phone",
  "country",
  "state",
  "city",
  "zip",
  "address",
  "linkedin",
  "twitter",
  "facebook",
  "instagram",
] as const;

export type BuiltInField = (typeof BUILT_IN_FIELDS)[number];

export interface PersonalizeContact {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  phone?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  zip?: string | null;
  address?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
  facebook?: string | null;
  instagram?: string | null;
  metadata?: Record<string, any> | null;
}

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]);
}

/**
 * Resolve every token in `body` against `contact`. Unresolved tokens are kept
 * verbatim so the UI can flag them; missing values render as empty string.
 *
 * If `escape` is true (the default) values are HTML-escaped — appropriate for
 * HTML bodies. Pass false for plain-text subjects/preview text.
 */
export function personalize(
  body: string,
  contact: PersonalizeContact | null | undefined,
  options: { escape?: boolean } = {},
): string {
  if (!body) return "";
  const escape = options.escape ?? true;
  return body.replace(TOKEN_PATTERN, (match, doubleBrace: string | undefined, singleBrace: string | undefined) => {
    const key = (doubleBrace ?? singleBrace ?? "").toLowerCase();
    const raw = resolveField(key, contact);
    if (raw === undefined || raw === null || raw === "") return match;
    return escape ? escapeHtml(String(raw)) : String(raw);
  });
}

export function resolveField(
  key: string,
  contact: PersonalizeContact | null | undefined,
): string | undefined {
  if (!contact) return undefined;
  const normalised = key.toLowerCase();

  switch (normalised) {
    case "first_name":
      return trim(contact.firstName);
    case "last_name":
      return trim(contact.lastName);
    case "name":
    case "full_name":
      return joinName(contact.firstName, contact.lastName) || trim(contact.email);
    case "email":
      return trim(contact.email);
    case "company":
      return trim(contact.company);
    case "title":
    case "job_title":
      return trim(contact.title);
    case "phone":
      return trim(contact.phone);
    case "country":
      return trim(contact.country);
    case "state":
      return trim(contact.state);
    case "city":
      return trim(contact.city);
    case "zip":
    case "postal_code":
      return trim(contact.zip);
    case "address":
      return trim(contact.address);
    case "linkedin":
      return trim(contact.linkedin);
    case "twitter":
      return trim(contact.twitter);
    case "facebook":
      return trim(contact.facebook);
    case "instagram":
      return trim(contact.instagram);
    default: {
      const meta = contact.metadata ?? {};
      const metaValue = meta[normalised] ?? meta[key] ?? meta[normalised.toUpperCase()];
      if (metaValue === undefined || metaValue === null) return undefined;
      return String(metaValue);
    }
  }
}

function trim(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const t = String(value).trim();
  return t.length === 0 ? undefined : t;
}

function joinName(first?: string | null, last?: string | null): string | undefined {
  const f = trim(first);
  const l = trim(last);
  if (f && l) return `${f} ${l}`;
  return f ?? l;
}

export interface UnresolvedToken {
  key: string;
  index: number;
  match: string;
}

/**
 * Returns every token in `body` that the contact does not satisfy. Used by the
 * preview pane to surface typos like `{{ frist_name }}` or empty leads.
 */
export function findUnresolved(body: string, contact: PersonalizeContact | null | undefined): UnresolvedToken[] {
  if (!body) return [];
  const results: UnresolvedToken[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(body)) !== null) {
    const key = (match[1] ?? match[2] ?? "").toLowerCase();
    const value = resolveField(key, contact);
    if (value === undefined || value === "") {
      results.push({ key, index: match.index, match: match[0] });
    }
  }
  return results;
}

/**
 * Lists every distinct token used in `body` (case-folded, deduped, in order of
 * first appearance). Used by the editor to warn about unused fields and by the
 * picker to highlight already-used chips.
 */
export function extractUsedTokens(body: string): string[] {
  if (!body) return [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(body)) !== null) {
    const key = (match[1] ?? match[2] ?? "").toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }
  return ordered;
}

/**
 * Returns the merge fields available for a contact — built-in fields union
 * with the keys discovered in their `metadata`. Used by the picker.
 */
export function availableFields(contact: PersonalizeContact | null | undefined): string[] {
  const out = new Set<string>(BUILT_IN_FIELDS);
  const meta = contact?.metadata ?? {};
  for (const k of Object.keys(meta)) out.add(k);
  return Array.from(out);
}

/**
 * Wraps a field name in the canonical `{{ field }}` token — what the editor
 * inserts at the caret when a chip is clicked.
 */
export function toToken(field: string): string {
  return `{{ ${field} }}`;
}

/**
 * Plain-text line-breaks for plain email bodies. Used when rendering the
 * preview as text-only.
 */
export function plainToHtml(body: string): string {
  if (!body) return "";
  return body
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 12px 0;line-height:1.55;">${para.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}
