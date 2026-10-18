// Generates one WAV per scene with OpenAI text-to-speech and writes public/narration.json (durations).
// Cached by text hash: re-running only calls the API for lines that changed.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, "../server/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing in server/.env");

const script = JSON.parse(readFileSync(join(root, "script.json"), "utf8"));
const MODEL = "gpt-4o-mini-tts";
mkdirSync(join(root, "public"), { recursive: true });
mkdirSync(join(root, ".cache"), { recursive: true });

/** Duration of a PCM WAV from its header. */
function wavSeconds(buf) {
  const sampleRate = buf.readUInt32LE(24);
  const byteRate = buf.readUInt32LE(28);
  let o = 12;
  while (o < buf.length - 8) {
    const id = buf.toString("ascii", o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    if (id === "data") return Math.min(size, buf.length - o - 8) / byteRate;
    o += 8 + size;
  }
  return (buf.length - 44) / byteRate || sampleRate;
}

const out = {};
let calls = 0, chars = 0;
for (const s of script.scenes) {
  const key = createHash("sha256").update([MODEL, script.voice, script.instructions, s.text].join("|")).digest("hex").slice(0, 16);
  const cache = join(root, ".cache", `${key}.wav`);
  if (!existsSync(cache)) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, voice: script.voice, input: s.text, instructions: script.instructions, response_format: "wav" }),
    });
    if (!res.ok) throw new Error(`TTS failed for ${s.id}: ${res.status} ${await res.text()}`);
    writeFileSync(cache, Buffer.from(await res.arrayBuffer()));
    calls++;
    chars += s.text.length;
  }
  const buf = readFileSync(cache);
  writeFileSync(join(root, "public", `${s.id}.wav`), buf);
  out[s.id] = { seconds: Number(wavSeconds(buf).toFixed(2)), text: s.text };
  console.log(s.id.padEnd(11), out[s.id].seconds.toFixed(1) + "s", cache.includes(key) ? "" : "");
}
writeFileSync(join(root, "public", "narration.json"), JSON.stringify(out, null, 2));
console.log(`API calls: ${calls}, characters sent: ${chars}, total narration: ${Object.values(out).reduce((a, b) => a + b.seconds, 0).toFixed(1)}s`);
