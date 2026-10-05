import { getSignalingStore, SignalingConfigError, signalingEnvironment } from "@/signaling/get-store";
import { isValidRoomId } from "@/lib/room";
import { isValidNoteSlug, sanitizeSlug } from "@/lib/slug";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function resolveNotePath(slug: string): Promise<string | null> {
  if (!isValidNoteSlug(slug)) return null;
  try {
    return await getSignalingStore().resolvePath(signalingEnvironment(), slug);
  } catch (error) {
    if (error instanceof SignalingConfigError) return null;
    return null;
  }
}

export async function claimNotePath(request: Request, roomId: string): Promise<Response> {
  if (!isValidRoomId(roomId)) return json({ error: "invalid_room" }, 400);
  let body: { slug?: unknown };
  try {
    body = (await request.json()) as { slug?: unknown };
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const slug = typeof body.slug === "string" ? sanitizeSlug(body.slug) : "";
  if (!isValidNoteSlug(slug)) return json({ error: "invalid_slug" }, 400);
  try {
    const result = await getSignalingStore().claimPath(signalingEnvironment(), roomId, slug);
    if (result === "taken") return json({ error: "taken" }, 409);
    return json({ slug });
  } catch (error) {
    if (error instanceof SignalingConfigError) return json({ error: "unconfigured" }, 503);
    return json({ error: "store_failed" }, 500);
  }
}
