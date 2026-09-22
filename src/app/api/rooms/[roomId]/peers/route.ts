import { getPeers } from "@/signaling/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const preferredRegion = "iad1";

export async function GET(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await context.params;
  return getPeers(request, roomId);
}
