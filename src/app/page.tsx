import { CreateNote, OpenNote } from "@/components/CreateNote";

export default function HomePage() {
  return (
    <main className="sheet sheet-home">
      <div className="sheet-tab" aria-hidden="true" />
      <p className="eyebrow">Shared notes</p>
      <h1>A note you can keep, share, and lock.</h1>
      <p className="lede">
        The text is saved in the cloud and on this device. Share the code at the end of the link. Add a password when
        the note should stay closed to everyone else.
      </p>
      <CreateNote />
      <OpenNote />
      <ul className="limits home-limits">
        <li>Saved in the cloud, and also on each device that opens it.</li>
        <li>Open a note by typing its code, the last part of the link after /n/.</li>
        <li>A password is asked before a locked note can be read.</li>
        <li>Without a password, anyone with the code can open the note.</li>
      </ul>
    </main>
  );
}
