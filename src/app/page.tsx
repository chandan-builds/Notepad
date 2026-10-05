import { CreateNote } from "@/components/CreateNote";

export default function HomePage() {
  return (
    <main className="sheet sheet-home">
      <div className="sheet-tab" aria-hidden="true" />
      <p className="eyebrow">Notes</p>
      <h1>A note you can keep and lock.</h1>
      <p className="lede">
        Name the note before it opens. The link uses that name. The text is saved in the cloud and on this device, and a
        password can keep it closed.
      </p>
      <CreateNote />
      <ul className="limits home-limits">
        <li>Saved in the cloud, and also on each device that opens it.</li>
        <li>The address is the name you choose, such as /n/meeting-notes.</li>
        <li>Bold, italic, underline, code, extra tabs, and a sticky window.</li>
        <li>A password is asked before a locked note can be read.</li>
      </ul>
    </main>
  );
}
