import { CreateNote } from "@/components/CreateNote";

export default function HomePage() {
  return (
    <main className="sheet sheet-home">
      <div className="sheet-tab" aria-hidden="true" />
      <p className="eyebrow">Peer to peer</p>
      <h1>A note that lives on the desks that open it.</h1>
      <p className="lede">
        Two browsers share one secret link. Keystrokes move directly between them. Nothing about the text is saved in
        the cloud.
      </p>
      <CreateNote />
      <ul className="limits home-limits">
        <li>Stored on each device that opens the link.</li>
        <li>Other people see edits while you are connected to each other.</li>
        <li>If every device loses its copy, the note is gone.</li>
        <li>Anyone with the full link can edit.</li>
      </ul>
    </main>
  );
}
