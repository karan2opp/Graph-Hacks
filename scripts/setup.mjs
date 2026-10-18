// One-time local setup: npm run setup
// Installs dependencies, creates the .env files, starts FalkorDB in Docker and loads the demo data.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const step = (n, text) => console.log(`\n\x1b[1m[${n}/4] ${text}\x1b[0m`);
const run = (cmd, label) => {
  const r = spawnSync(cmd, { cwd: root, stdio: "inherit", shell: true, env: process.env });
  if (r.status !== 0) {
    console.error(`\n\x1b[31m${label} failed.\x1b[0m`);
    process.exit(r.status ?? 1);
  }
};

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`Node 20 or newer is needed (you have ${process.versions.node}).`);
  process.exit(1);
}
if (spawnSync("docker info", { shell: true, stdio: "ignore" }).status !== 0) {
  console.error("Docker is not running. Start Docker Desktop, then run `npm run setup` again.");
  process.exit(1);
}

step(1, "Installing dependencies (server and client)");
run("npm --prefix server install && npm --prefix client install", "Install");

step(2, "Creating .env files");
for (const dir of ["server", "client"]) {
  const target = join(root, dir, ".env");
  if (existsSync(target)) console.log(`${dir}/.env already exists, kept as is`);
  else {
    copyFileSync(join(root, dir, ".env.example"), target);
    if (dir === "client") {
      // turn on the "Use the demo account" button on the sign-in page (matches the seeded account)
      writeFileSync(target, readFileSync(target, "utf8").replace(/^# (VITE_DEMO_(EMAIL|PASSWORD)=)/gm, "$1"));
    }
    console.log(`${dir}/.env created from ${dir}/.env.example`);
  }
}
const hasKey = /^OPENAI_API_KEY=\S+/m.test(readFileSync(join(root, "server/.env"), "utf8"));

step(3, "Starting FalkorDB (Docker)");
run("docker compose up -d", "Starting FalkorDB");

step(4, "Loading the demo data");
run("npm --prefix server run seed", "Seeding");

console.log(`
\x1b[32mSetup complete.\x1b[0m

  Start the app:   npm run dev
  Open:            http://localhost:5173
  Demo sign-in:    demo@casememory.test / casememory-demo-2026
  Graph browser:   http://localhost:3000  (host localhost, port 6379, no username or password)
${
  hasKey
    ? ""
    : `
  \x1b[33mserver/.env has no OPENAI_API_KEY.\x1b[0m The demo cases still open, but asking questions and reading
  new uploads need it. Add the key, then restart \`npm run dev\`.
`
}`);
