export const MAX_CLOUD_UPDATES = 80;
export const MAX_CLOUD_UPDATE_CHARS = 400_000;

export function isVerifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9+/]{40,88}={0,2}$/.test(value);
}

export function isCloudUpdate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_CLOUD_UPDATE_CHARS;
}

export function isSalt(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9+/]{20,32}={0,2}$/.test(value);
}
