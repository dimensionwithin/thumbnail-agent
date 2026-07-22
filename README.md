# Back-Catalog Thumbnail Agent

An LLM-driven pipeline that regenerates YouTube thumbnails across an entire back-catalog —
and never publishes without a human's approval.

For each video it pulls the metadata, uses the Claude API to decide a headline and a
bullish/bearish/neutral stance, renders a thumbnail through a Playwright/HTML compositor,
and assembles a **contact sheet for review**. Nothing goes live until you sign off.

---

## Design principle: propose, never blind-publish

The agent is built around a **human-in-the-loop gate**. It generates candidates and
recommendations; the actual publish step happens only after manual approval, with backup and
restore around every change to a live channel. Automation handles the work — the human keeps
the final call.

---

## Pipeline

```
youtube/    → authenticate (OAuth desktop flow) + inventory the back-catalog
decision/   → Claude API: condense headline + classify stance (bullish/bearish/neutral)
render      → Playwright drives an HTML thumbnail compositor
review/     → build a contact sheet for human sign-off
publish/    → backup → publish → restore, only after approval
```

---

## LLM integration details

- **`@anthropic-ai/sdk`** — a documented Claude wrapper (`src/decision/client.js`).
- **Prompt caching** (`cache_control: ephemeral`) to keep token cost down across a large
  back-catalog run.
- **Deterministic mock mode** — the entire pipeline runs credential-free (no network, no
  secrets) for testing, then cleanly cuts over to real credentials with quota-aware batching.

---

## Tech

`Node.js` (CommonJS) · `Anthropic Claude API` · `YouTube Data API v3` (`googleapis` + OAuth)
· `Playwright`

---

## Notes

- Requires an Anthropic API key and YouTube OAuth credentials to run against a real channel;
  runs fully in mock mode without them.
- Secrets (`.env`, OAuth tokens) are git-ignored and never committed.

---

## License

*(add license)*
