import { isValidRoomId } from "@/lib/room";

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SLUG_MAX = 48;

export function sanitizeSlug(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const singleSpaced = trimmed.replace(/\s+/g, "-");
  const cleaned = singleSpaced.replace(/[^a-z0-9-]/g, "");
  const collapsed = cleaned.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return collapsed.slice(0, SLUG_MAX);
}

/** A custom path is a readable slug, and it must not look like a room id. */
export function isValidNoteSlug(value: string): boolean {
  return value.length > 0 && value.length <= SLUG_MAX && SLUG_REGEX.test(value) && !isValidRoomId(value);
}

/** The address segment created from the name chosen before a note opens. */
export function linkSlugFromTitle(title: string): string | null {
  const slug = sanitizeSlug(title);
  return isValidNoteSlug(slug) ? slug : null;
}
