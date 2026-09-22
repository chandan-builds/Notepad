# Notepad

A plain-text note saved in the cloud and on each device. Share it with the code at the end of the link. An optional password is required before a locked note can be read. Live edits still move over a WebRTC data channel while people are online.

## Run locally

```bash
npm install
npm run dev
```

With Redis unset, `next dev` keeps notes and the signaling mailbox in memory. Open the app, start a note, and open the same code in a second browser profile.

```bash
npm test
npm run build
```

## Production

Set these on the Vercel project. Preview and production refuse to signal if Redis is missing.

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
NEXT_PUBLIC_STUN_URLS=stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302
```

Redis stores the note, an optional password check, and short-lived signaling envelopes. A password is checked in the browser; the cloud copy of a locked note is encrypted before it is saved.

Version 1 uses STUN only. If a network cannot open a direct peer connection, the note stays on the device and the page says so.
