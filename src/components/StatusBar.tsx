"use client";

type StatusBarProps = {
  label: string;
  detail: string;
  peerCount: number;
  canRetry: boolean;
  onRetry: () => void;
};

export function StatusBar({ label, detail, peerCount, canRetry, onRetry }: StatusBarProps) {
  const people = peerCount === 1 ? "1 person" : `${peerCount} people`;
  return (
    <div className="status-bar">
      <p className="status-live" role="status" aria-live="polite">
        <span className="status-label">{label}</span>
        <span className="status-dot" aria-hidden="true" />
        <span>{detail}</span>
      </p>
      <p className="status-count">
        {people}
        {canRetry ? (
          <button className="text-button" type="button" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </p>
    </div>
  );
}
