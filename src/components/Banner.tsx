"use client";

import type { SessionBanner } from "@/collaboration/session";

type BannerProps = {
  banners: SessionBanner[];
  canRetry: boolean;
  onRetry: () => void;
};

export function Banner({ banners, canRetry, onRetry }: BannerProps) {
  if (banners.length === 0) return null;
  return (
    <div className="banners">
      {banners.map((banner) => (
        <div className={`banner banner-${banner.tone}`} key={banner.id} role="status">
          <p>{banner.text}</p>
          {banner.id === "ice" && canRetry ? (
            <button className="text-button" type="button" onClick={onRetry}>
              Try again
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
