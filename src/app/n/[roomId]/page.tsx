import { MessagePage } from "@/components/MessagePage";
import { NotepadApp } from "@/components/NotepadApp";
import { isValidRoomId } from "@/lib/room";

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  if (!isValidRoomId(roomId)) {
    return (
      <MessagePage
        eyebrow="Unreadable link"
        title="This link is not a note."
        body="The address is malformed. Ask for the full link again, including the part after the #."
      />
    );
  }
  return <NotepadApp roomId={roomId} />;
}
