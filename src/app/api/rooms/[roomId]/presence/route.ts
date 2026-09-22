import { deletePresence, postPresence } from "@/signaling/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

type Context = { params: Promise<{ roomId: string }> };

export async function POST(request: Request, context: Context) {
  const { roomId } = await context.params;
  return postPresence(request, roomId);
}

export async function DELETE(request: Request, context: Context) {
  const { roomId } = await context.params;
  return deletePresence(request, roomId);
}
