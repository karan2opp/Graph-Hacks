import React from "react";
import {
  AbsoluteFill,
  Html5Audio,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import narration from "../public/narration.json";
import scenes from "../public/scenes.json";

export const FPS = 30;
const INTRO_PAD = 1.2; // seconds of picture after the intro line ends
const OUTRO_PAD = 2;
const WOOD = "#3a2318";
const PAPER = "#e4ebe0";
const GOLD = "#d9a85b";
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Segoe UI', system-ui, sans-serif";

type SceneId = "graph" | "drift" | "directions" | "ask";
const CLIPS: { id: SceneId; label: string; agent: string }[] = [
  { id: "graph", label: "The memory is a graph", agent: "FalkorDB Browser · live data" },
  { id: "drift", label: "Story drift", agent: "Fact-check agent" },
  { id: "directions", label: "Directions", agent: "Compliance agent" },
  { id: "ask", label: "Ask the case", agent: "Q&A agent · cited answers" },
];

const sec = (s: number) => Math.round(s * FPS);
const introFrames = sec(narration.intro.seconds + INTRO_PAD);
const outroFrames = sec(narration.outro.seconds + OUTRO_PAD);
const clipFrames = (id: SceneId) => sec(scenes[id].end - scenes[id].start);

export const totalFrames = () => introFrames + CLIPS.reduce((n, c) => n + clipFrames(c.id), 0) + outroFrames;

/** Narration as subtitles: one sentence at a time, timed by its share of the characters. */
const Captions: React.FC<{ text: string; seconds: number; delay?: number }> = ({ text, seconds, delay = 0 }) => {
  const frame = useCurrentFrame();
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const total = sentences.reduce((n, s) => n + s.length, 0);
  const t = frame / FPS - delay;
  let acc = 0;
  let current = "";
  for (const s of sentences) {
    const len = (s.length / total) * seconds;
    if (t >= acc && t < acc + len) current = s.trim();
    acc += len;
  }
  if (!current) return null;
  return (
    <div style={{ position: "absolute", bottom: 48, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <div
        style={{
          maxWidth: 1400, padding: "14px 28px", borderRadius: 10, background: "rgba(20,12,8,.82)", color: "#fff",
          fontFamily: SANS, fontSize: 38, lineHeight: 1.3, textAlign: "center",
        }}
      >
        {current}
      </div>
    </div>
  );
};

const FadeIn: React.FC<{ children: React.ReactNode; frames?: number }> = ({ children, frames = 12 }) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ opacity: interpolate(frame, [0, frames], [0, 1], { extrapolateRight: "clamp" }) }}>{children}</AbsoluteFill>;
};

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = (at: number) => spring({ frame: frame - at, fps, config: { damping: 200 } });
  const problems = [
    ["Years of hearings", "Dozens of dates, orders and filings per case"],
    ["Directions forgotten", "Deadlines slip and costs follow"],
    ["Stories change", "A denial in 2021, an admission in 2023"],
  ];
  return (
    <AbsoluteFill style={{ background: WOOD, color: "#fff", fontFamily: SANS, padding: "120px 140px" }}>
      <div style={{ opacity: rise(0), transform: `translateY(${(1 - rise(0)) * 30}px)` }}>
        <div style={{ color: GOLD, letterSpacing: 4, fontSize: 26, textTransform: "uppercase" }}>Graph Hacks · Agent memory</div>
        <div style={{ fontFamily: SERIF, fontSize: 120, marginTop: 10 }}>Case Memory</div>
        <div style={{ fontSize: 40, color: "#e9dccb", marginTop: 6 }}>A memory for every court case, built on a FalkorDB graph</div>
      </div>
      <div style={{ display: "flex", gap: 36, marginTop: 110 }}>
        {problems.map(([title, sub], i) => {
          const p = rise(sec(3 + i * 2.6));
          return (
            <div
              key={title}
              style={{
                flex: 1, opacity: p, transform: `translateY(${(1 - p) * 40}px)`, background: "rgba(255,255,255,.06)",
                border: `2px solid ${i === 2 ? "#c9564b" : "rgba(255,255,255,.18)"}`, borderRadius: 14, padding: "34px 36px",
              }}
            >
              <div style={{ fontFamily: SERIF, fontSize: 50 }}>{title}</div>
              <div style={{ fontSize: 30, color: "#d9cbb9", marginTop: 12 }}>{sub}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Clip: React.FC<{ id: SceneId; label: string; agent: string }> = ({ id, label, agent }) => {
  const frame = useCurrentFrame();
  const tag = interpolate(frame, [0, 12, sec(4), sec(4) + 12], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <FadeIn>
      <AbsoluteFill style={{ background: PAPER }}>
        <OffthreadVideo src={staticFile("recording.webm")} trimBefore={sec(scenes[id].start)} muted style={{ width: "100%", height: "100%" }} />
        <div
          style={{
            position: "absolute", top: 120, left: 60, opacity: tag, transform: `translateX(${(1 - tag) * -30}px)`,
            background: WOOD, color: "#fff", borderLeft: `8px solid ${GOLD}`, borderRadius: 8, padding: "16px 26px", fontFamily: SANS,
            boxShadow: "0 10px 30px rgba(0,0,0,.25)",
          }}
        >
          <div style={{ fontFamily: SERIF, fontSize: 44 }}>{label}</div>
          <div style={{ fontSize: 26, color: GOLD, marginTop: 4 }}>{agent}</div>
        </div>
        <Captions text={narration[id].text} seconds={narration[id].seconds} />
      </AbsoluteFill>
      <Html5Audio src={staticFile(`${id}.wav`)} />
    </FadeIn>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 200 } });
  const line = (at: number) => interpolate(frame, [sec(at), sec(at) + 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: WOOD, color: "#fff", fontFamily: SANS, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <div style={{ fontFamily: SERIF, fontSize: 130, opacity: p, transform: `scale(${0.94 + 0.06 * p})` }}>Case Memory</div>
      <div style={{ fontSize: 44, color: "#e9dccb", marginTop: 18, opacity: line(1) }}>One graph · four agents · every answer traceable</div>
      <div style={{ fontSize: 40, color: GOLD, marginTop: 60, opacity: line(3), fontFamily: "Consolas, monospace" }}>github.com/karan2opp/Graph-Hacks</div>
      <div style={{ fontSize: 28, color: "#cdbfae", marginTop: 26, opacity: line(4.5) }}>
        Built on FalkorDB · Graph Hacks 2026 · synthetic data only, not legal advice
      </div>
    </AbsoluteFill>
  );
};

export const Demo: React.FC = () => {
  let from = 0;
  const at = (frames: number) => {
    const start = from;
    from += frames;
    return start;
  };
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Sequence from={at(introFrames)} durationInFrames={introFrames}>
        <Intro />
        <Sequence from={sec(0.4)}>
          <Html5Audio src={staticFile("intro.wav")} />
          <Captions text={narration.intro.text} seconds={narration.intro.seconds} />
        </Sequence>
      </Sequence>
      {CLIPS.map((c) => (
        <Sequence key={c.id} from={at(clipFrames(c.id))} durationInFrames={clipFrames(c.id)}>
          <Clip {...c} />
        </Sequence>
      ))}
      <Sequence from={at(outroFrames)} durationInFrames={outroFrames}>
        <FadeIn frames={15}>
          <Outro />
        </FadeIn>
        <Sequence from={sec(0.6)}>
          <Html5Audio src={staticFile("outro.wav")} />
        </Sequence>
      </Sequence>
    </AbsoluteFill>
  );
};
