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
CLOUDFLARE_TURN_KEY_ID
CLOUDFLARE_TURN_KEY_API_TOKEN
```

Redis stores the note, an optional password check, and short-lived signaling envelopes. A password is checked in the browser; the cloud copy of a locked note is encrypted before it is saved.

The Cloudflare values come from the dashboard under Realtime → TURN. They stay on the server and mint a 12-hour relay credential when a note opens. Without them, people on networks that block a direct connection still sync through the cloud copy, a second or two later. After adding the variables, redeploy so the live deployment picks them up.
