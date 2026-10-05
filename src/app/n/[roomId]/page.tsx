import { MessagePage } from "@/components/MessagePage";
import { NotepadApp } from "@/components/NotepadApp";
import { resolveNotePath } from "@/lib/note-path";
import { isValidRoomId } from "@/lib/room";
import { isValidNoteSlug } from "@/lib/slug";

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId: segment } = await params;
  if (isValidRoomId(segment)) {
    return <NotepadApp roomId={segment} pathSegment={segment} />;
  }
  if (isValidNoteSlug(segment)) {
    const roomId = await resolveNotePath(segment);
    if (!roomId) {
      return (
        <MessagePage
          eyebrow="Missing note"
          title="This path has no note."
          body="The address doesn’t match a note. Check the path and try again."
        />
      );
    }
    return <NotepadApp roomId={roomId} pathSegment={segment} />;
  }
  return (
    <MessagePage
      eyebrow="Unreadable link"
      title="This link is not a note."
      body="The address is malformed. Ask for the full link again."
    />
  );
}
