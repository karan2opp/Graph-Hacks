// Records the real app with Playwright, scene by scene, paced to the narration.
// Writes public/recording.webm and public/scenes.json ({ id: { start, end } } in seconds from the start of the video).
// Needs: the API with the real OpenAI key and the client running (see README in this folder), FalkorDB Browser on :3000.
const { chromium } = require(require.resolve("@playwright/test", { paths: [require("path").join(__dirname, "../../client")] }));
const fs = require("fs");
const path = require("path");

const APP = process.env.APP_URL || "http://localhost:5175";
const FALKOR = process.env.FALKOR_URL || "http://localhost:3000";
const GRAPH = process.env.GRAPH || "court_video";
const W = 1600;
const H = 900;
const ROOT = path.join(__dirname, "..");
const SHOTS = process.env.SHOTS; // folder for debug screenshots
const narration = JSON.parse(fs.readFileSync(path.join(ROOT, "public/narration.json"), "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A visible cursor (Playwright's mouse is invisible in recordings) and a ring on click.
const CURSOR = () => {
  const install = () => {
    if (document.getElementById("__cursor")) return;
    const c = document.createElement("div");
    c.id = "__cursor";
    c.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 2147483647, pointerEvents: "none", transform: "translate(-200px,-200px)" });
    document.documentElement.appendChild(c);
    addEventListener("mousemove", (e) => (c.style.transform = `translate(${e.clientX - 4}px,${e.clientY - 2}px)`), true);
    addEventListener(
      "mousedown",
      (e) => {
        const r = document.createElement("div");
        Object.assign(r.style, {
          position: "fixed", left: e.clientX - 18 + "px", top: e.clientY - 18 + "px", width: "36px", height: "36px", borderRadius: "50%",
          border: "3px solid #e0a03a", zIndex: 2147483646, pointerEvents: "none", transition: "transform .5s, opacity .5s",
        });
        document.documentElement.appendChild(r);
        requestAnimationFrame(() => Object.assign(r.style, { transform: "scale(1.8)", opacity: "0" }));
        setTimeout(() => r.remove(), 600);
      },
      true,
    );
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install);
  else install();
};

(async () => {
  const browser = await chromium.launch();

  // --- off camera: create a fresh firm (it gets the demo cases), and log in to the FalkorDB Browser
  const setup = await browser.newContext({ viewport: { width: W, height: H } });
  const sp = await setup.newPage();
  await sp.goto(`${APP}/register`);
  await sp.getByLabel("Firm or chambers name").fill("Rao & Associates");
  await sp.getByLabel("Your name").fill("Kavita Rao");
  await sp.getByLabel("Email").fill(`video${Date.now()}@example.test`);
  await sp.getByLabel("Password").fill("correct-horse-42");
  await sp.getByRole("button", { name: "Create account" }).click();
  await sp.waitForURL(/\/app$/);
  await sp.goto(FALKOR, { waitUntil: "networkidle" });
  if (await sp.locator("#submit-button").isVisible().catch(() => false)) {
    const tls = sp.locator("input[type=checkbox]");
    if (await tls.isChecked().catch(() => false)) await tls.uncheck({ force: true }).catch(() => {});
    await sp.locator("#submit-button").click();
    await sp.waitForURL(/\/graph/);
  }
  // dismiss the first-run tutorial; the choice is kept in storage for the recorded session
  const skipTour = sp.getByRole("button", { name: "Skip Tutorial" });
  await skipTour.waitFor({ timeout: 8000 }).then(() => skipTour.click()).catch(() => {});
  await sleep(500);
  const state = await setup.storageState();
  await setup.close();
  await sleep(12000); // let the background job embed the demo text, so the question finds it

  // --- on camera
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    storageState: state,
    recordVideo: { dir: path.join(ROOT, ".cache/rec"), size: { width: W, height: H } },
  });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  const scenes = {};
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

  let mouse = { x: W / 2, y: H / 2 };
  const glide = async (loc, opts = {}) => {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const b = await loc.boundingBox();
    if (!b) throw new Error("not visible: " + loc);
    const x = b.x + (opts.dx ?? b.width / 2);
    const y = b.y + (opts.dy ?? b.height / 2);
    await page.mouse.move(x, y, { steps: opts.steps ?? 28 });
    mouse = { x, y };
    await sleep(opts.pause ?? 250);
  };
  const click = async (loc, opts) => {
    await glide(loc, opts);
    await page.mouse.click(mouse.x, mouse.y);
  };
  /** Runs one scene and holds it until its narration has finished. */
  const scene = async (id, prepare, act) => {
    await prepare();
    await page.mouse.move(mouse.x, mouse.y);
    const start = now();
    await act();
    const need = narration[id].seconds + 0.8;
    const left = need - (now() - start);
    if (left > 0) await sleep(left * 1000);
    scenes[id] = { start: Number(start.toFixed(2)), end: Number(now().toFixed(2)) };
    await shot(id);
    console.log(id, scenes[id]);
  };

  // 1. The graph, in the FalkorDB Browser
  await scene(
    "graph",
    async () => {
      await page.goto(`${FALKOR}/graph`, { waitUntil: "networkidle" });
      const skip = page.getByRole("button", { name: "Skip Tutorial" });
      await skip.waitFor({ timeout: 3000 }).then(() => skip.click()).catch(() => {});
      await page.getByRole("button", { name: "Select Graph" }).click();
      await page.getByText(GRAPH, { exact: true }).first().click();
      await sleep(800);
    },
    async () => {
      await click(page.locator(".monaco-editor").first());
      await page.keyboard.press("Control+A");
      // inserted as one block: typed keystrokes trigger the editor's autocomplete and bracket closing
      await sleep(400);
      await page.keyboard.insertText("MATCH p=(c:Claim)-[:MADE_BY|ABOUT|CONTRADICTS]->(n) RETURN p LIMIT 120");
      await sleep(1200);
      await click(page.locator("button", { hasText: /^RUN$/ }).first());
      await sleep(4500);
      // park the cursor off the canvas: hovering a node or edge makes the browser fade the rest
      await page.mouse.move(150, H * 0.62, { steps: 40 });
      mouse = { x: 150, y: H * 0.62 };
    },
  );

  // 2. Story drift
  await scene(
    "drift",
    async () => {
      await page.goto(`${APP}/app`);
      await page.getByRole("link", { name: /Ramesh Kumar v\. Suresh Gupta/ }).first().click();
      await page.getByRole("link", { name: /Story drift/ }).click();
      await page.getByRole("heading", { level: 2, name: /Suresh Gupta/ }).first().waitFor();
      await sleep(600);
    },
    async () => {
      const first = page.locator("article").filter({ hasText: "I received the said amount" }).first();
      await glide(first, { dy: 40 });
      await sleep(2500);
      await page.mouse.wheel(0, 260);
      await sleep(2500);
      await click(first.getByRole("button", { name: "Add to cross prep" }));
      await sleep(1500);
    },
  );

  // 3. Directions
  await scene(
    "directions",
    async () => {
      await page.getByRole("link", { name: /^Directions/ }).click();
      await page.locator(".stamp-red", { hasText: "Overdue" }).first().waitFor();
      await sleep(600);
    },
    async () => {
      const row = page.locator(".drow").filter({ hasText: "Plaintiff to file rejoinder" });
      await glide(row.locator(".stamp-red").first());
      await sleep(1500);
      const select = row.getByLabel("Your call");
      await glide(select);
      await select.selectOption("complied");
      await sleep(600);
      const reason = row.getByLabel("Reason (optional)");
      if (await reason.isVisible().catch(() => false)) {
        await click(reason);
        await reason.pressSequentially("Filed at the counter on 5 Oct", { delay: 35 });
      }
      await click(row.getByRole("button", { name: "Save" }));
      await page.getByText("Your call is saved").waitFor().catch(() => {});
      await sleep(1200);
    },
  );

  // 4. Ask the case
  await scene(
    "ask",
    async () => {
      await page.getByRole("link", { name: "Ask the case", exact: true }).click();
      await page.getByLabel("Ask a question").waitFor();
      await sleep(600);
    },
    async () => {
      const box = page.getByLabel("Ask a question");
      await click(box);
      await box.pressSequentially("What has Suresh Gupta said about the Rs. 5 lakh payment, and has he contradicted himself?", { delay: 22 });
      const answered = page.waitForResponse((r) => r.url().includes("/ask") && r.request().method() === "POST", { timeout: 90000 });
      await click(page.getByRole("button", { name: "Send" }));
      await answered;
      await sleep(3000);
      await click(page.getByRole("tab", { name: "Evidence graph" }));
      await sleep(4500);
      await click(page.getByRole("tab", { name: "How I found this" }));
      await sleep(3500);
    },
  );

  await sleep(500);
  const video = page.video();
  await ctx.close();
  await browser.close();
  fs.copyFileSync(await video.path(), path.join(ROOT, "public/recording.webm"));
  fs.writeFileSync(path.join(ROOT, "public/scenes.json"), JSON.stringify(scenes, null, 2));
  console.log("saved public/recording.webm, total", now().toFixed(1), "s");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
