# Demo video

The submission video (~1:50, 1080p): the real app recorded with Playwright, an OpenAI voice-over, assembled with [Remotion](https://www.remotion.dev).

| Step | Command | What it does |
|---|---|---|
| 1 | `npm run tts` | Turns `script.json` into one WAV per scene (`gpt-4o-mini-tts`), cached in `.cache/`. Re-running only calls the API for lines that changed |
| 2 | `node scripts/capture.cjs` | Signs up a fresh firm (it gets the demo cases), then records the FalkorDB Browser and the app scene by scene, each held for its narration. Writes `public/recording.webm` and `public/scenes.json` |
| 3 | `npx remotion render src/index.ts Demo out/case-memory-demo.mp4 --browser-executable=<chrome-headless-shell>` | Intro, the four recorded scenes with labels and captions, outro |

For step 2, run an API with the real OpenAI key on its own graph and a client pointing at it, plus the FalkorDB Browser on `:3000`:

```bash
PORT=5056 FALKORDB_GRAPH=court_video CLIENT_URL=http://localhost:5175 npx tsx ../server/src/index.ts
API_PROXY_TARGET=http://localhost:5056 npx vite --port 5175   # in client/
```

OpenAI use per full run: 6 TTS lines (once, then cached), embedding the demo text, and one question.
