const PREFIX = "notepadly:pending-title:";

export function rememberPendingTitle(slug: string, title: string): void {
  sessionStorage.setItem(PREFIX + slug, title);
}

export function takePendingTitle(slug: string): string | null {
  const key = PREFIX + slug;
  const value = sessionStorage.getItem(key);
  if (!value) return null;
  sessionStorage.removeItem(key);
  return value;
}
