import { claimNotePath } from "@/lib/note-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const preferredRegion = "iad1";

type Context = { params: Promise<{ roomId: string }> };

export async function POST(request: Request, context: Context) {
  const { roomId } = await context.params;
  return claimNotePath(request, roomId);
}
