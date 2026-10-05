import { CreateNote } from "@/components/CreateNote";

export default function HomePage() {
  return (
    <main className="sheet sheet-home">
      <div className="sheet-tab" aria-hidden="true" />
      <p className="eyebrow">Notes</p>
      <h1>A note you can keep and lock.</h1>
      <p className="lede">
        The text is saved in the cloud and on this device. Give it a title and a custom path, format the writing, and
        add a password when the note should stay closed.
      </p>
      <CreateNote />
      <ul className="limits home-limits">
        <li>Saved in the cloud, and also on each device that opens it.</li>
        <li>Set a custom path so the note lives at an address you choose.</li>
        <li>Bold, italic, underline, code, extra tabs, and a sticky window.</li>
        <li>A password is asked before a locked note can be read.</li>
      </ul>
    </main>
  );
}
