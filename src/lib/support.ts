export function detectWebRTC(): boolean {
  return (
    typeof RTCPeerConnection === "function" &&
    typeof RTCPeerConnection.prototype?.createDataChannel === "function"
  );
}

export function detectIndexedDB(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}
