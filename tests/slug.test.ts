import { describe, expect, it } from "vitest";
import { randomSecret } from "@/lib/room";
import { isValidNoteSlug, linkSlugFromTitle, sanitizeSlug } from "@/lib/slug";

describe("note slugs", () => {
  it("turns a title into a path and rejects room ids", () => {
    expect(sanitizeSlug("  My Meeting Notes! ")).toBe("my-meeting-notes");
    expect(isValidNoteSlug("my-meeting-notes")).toBe(true);
    expect(isValidNoteSlug("")).toBe(false);
    expect(isValidNoteSlug("-nope")).toBe(false);
    expect(isValidNoteSlug(randomSecret().toLowerCase())).toBe(false);
    expect(linkSlugFromTitle("  Meeting Notes! ")).toBe("meeting-notes");
    expect(linkSlugFromTitle("!!!")).toBeNull();
  });
});
