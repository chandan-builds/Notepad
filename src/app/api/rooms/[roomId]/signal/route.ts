import { getSignal, postSignal } from "@/signaling/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

type Context = { params: Promise<{ roomId: string }> };

export async function POST(request: Request, context: Context) {
  const { roomId } = await context.params;
  return postSignal(request, roomId);
}

export async function GET(request: Request, context: Context) {
  const { roomId } = await context.params;
  return getSignal(request, roomId);
}
