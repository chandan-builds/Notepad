"use client";

type MessagePageProps = {
  eyebrow: string;
  title: string;
  body: string;
};

export function MessagePage({ eyebrow, title, body }: MessagePageProps) {
  return (
    <main className="sheet sheet-message">
      <div className="sheet-tab" aria-hidden="true" />
      <a className="mark" href="/">
        Notepad
      </a>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="lede">{body}</p>
    </main>
  );
}
