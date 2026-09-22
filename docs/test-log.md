# Test log

Date: 22 September 2026.

Browser for the manual rows: Cursor’s embedded Chromium on Windows, `next dev` at `http://localhost:3000`, in-memory signaling store (Redis unset).

## Automated

`npm test` — 17 tests passed:

- Room id and fragment parser
- AES-GCM round-trip, flipped byte, wrong key
- Memory store expiry, mailbox cap, addressed delivery
- Route validation, including production 503 when Redis is unset
- Yjs sequential, reversed, duplicate, concurrent, and offline merge
- 16 KB frame reassembly
- Yjs sync over a fake data channel
- Eight-peer admission

`npm run build` succeeded. `npx tsc --noEmit` succeeded after the route test type fix.

## Manual, localhost

| Case | Result |
| --- | --- |
| Create a note | Pass. URL has a 22-character room id and a fragment. Status: “On this device”. |
| Type, refresh | Pass. “Hello” was in the editor after reload, before further typing. |
| Second tab opens the full link | Pass. Status became “Connected”, 2 people. The second tab showed “Hello” without retyping. |
| Second tab appends | Pass. Both tabs showed “Hello World”. |
| Signaling URLs | Pass. Requests contain the room id and peer id. None contain the fragment. |
| Mailbox after connect | Pass. Signal polling stopped (last mailbox poll was minutes old while presence continued). |
| Malformed room id | Pass. “This link is not a note.” |
| Fragment stripped | Pass. “This page needs the full link.” No editor. |
| Narrow viewport (390px) | Pass. Header stacks. No horizontal overflow. |

## Not run

These rows from the plan were not executed in this pass:

- Chrome + Firefox, Chrome + Safari, mobile Safari, phone hotspot
- DevTools offline edit and reconnect
- Ninth peer / room-full banner
- IndexedDB disabled, delete-local-copy against a live peer
- Forced ICE failure
- Vercel preview and production with Upstash Redis

A same-machine Chromium pair is not a NAT test. Networks that need TURN will still fail closed until that follow-up exists.
