import { getCloud, postCloud } from "@/cloud/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
export const preferredRegion = "iad1";

type Context = { params: Promise<{ roomId: string }> };

export async function GET(_request: Request, context: Context) {
  const { roomId } = await context.params;
  return getCloud(roomId);
}

export async function POST(request: Request, context: Context) {
  const { roomId } = await context.params;
  return postCloud(request, roomId);
}
