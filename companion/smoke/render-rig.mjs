/**
 * Smoke test against the dev rig: take the newest saved race on the timer, fake a sidecar
 * (the alignment a real recording would carry), render the overlay-only track, and decode
 * it back to count frames. Runs where a Chromium and an ffmpeg with libvpx-vp9 exist — the
 * Playwright image does:
 *
 *   docker run --rm --network host -v "$PWD/companion:/work" -w /work \
 *     -e GRIDFPV_FFMPEG=/ms-playwright/ffmpeg-1013/ffmpeg-linux -e GRIDFPV_BROWSER= \
 *     mcr.microsoft.com/playwright:v1.64.1-noble node smoke/render-rig.mjs
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { frameCount } from "../src/frames.js";
import { renderRun } from "../src/render.js";
import { Timer } from "../src/timer.js";

const log = (m) => console.log(m);
const cfg = {
  ...loadConfig({
    env: {
      ...process.env,
      GRIDFPV_TIMER: process.env.RH_URL ?? "http://localhost:5050",
    },
  }),
  timerUser: process.env.RH_USER ?? "admin",
  timerPass: process.env.RH_PASS ?? "rotorhazard",
  composite: false,
  overlayOnly: "vp9",
  fps: 30,
  outDir: await fs.mkdtemp(path.join(os.tmpdir(), "gridfpv-smoke-")),
};

const timer = new Timer(cfg.timer, {
  user: cfg.timerUser,
  pass: cfg.timerPass,
  log,
}).connect();
const list = await new Promise((resolve, reject) => {
  timer.once("race_list", resolve);
  setTimeout(() => reject(new Error("no race_list from the timer")), 15_000);
});
const all = list.flatMap((h) => h.rounds.map((r) => ({ heat: h, round: r })));
if (!all.length)
  throw new Error("the timer has no saved race; run an e2e spec first");
const pick = all.at(-1);
const prs = [];
for (const pr of pick.round.pilotraces)
  prs.push(await timer.pilotRace(pr.pilotraceId));
timer.close();
const lastStamp = Math.max(
  0,
  ...prs.flatMap((p) => p.laps.filter((l) => !l.deleted).map((l) => l.stampMs)),
);

// A recording that began 2.5 s before staging, which began 2 s before the start; stopped 1.5 s after the last lap, 2 s tail.
const data = {
  recording: path.join(cfg.outDir, "clean.mkv"),
  heat_id: pick.heat.heatId,
  round: pick.round.round,
  race_id: pick.round.raceId,
  race_start_ms: 4500,
  staging_ms: -2000,
  end_ms: lastStamp + 1500,
  duration_ms: 4500 + lastStamp + 1500 + 2000,
};
log(
  `race: heat ${data.heat_id} round ${data.round}, last lap at ${lastStamp} ms → ${frameCount(data.duration_ms, cfg.fps)} frames`,
);
const out = await renderRun({ cfg, data, log });
log(`title: ${out.title}; laps: ${out.lapStamps.join(", ")}`);

// Decode it back: the frame count must match the plan, and the stream must carry alpha.
const probe = await new Promise((resolve) => {
  const p = spawn(cfg.ffmpeg, [
    "-hide_banner",
    "-i",
    out.files[0],
    "-f",
    "null",
    "-",
  ]);
  let err = "";
  p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ code, err }));
});
const frames = Number(
  /frame=\s*(\d+)/.exec(
    probe.err
      .replace(/\r/g, "\n")
      .split("\n")
      .filter((l) => l.includes("frame="))
      .at(-1),
  )?.[1],
);
const alpha = /yuva420p|alpha_mode/.test(probe.err);
log(
  `decoded: exit ${probe.code}, ${frames} frames, alpha ${alpha ? "yes" : "NO"}`,
);
const size = (await fs.stat(out.files[0])).size;
log(`file: ${out.files[0]} (${size} bytes)`);
if (
  probe.code !== 0 ||
  frames !== frameCount(data.duration_ms, cfg.fps) ||
  !alpha ||
  size < 1000
) {
  console.error("SMOKE FAILED");
  process.exit(1);
}
log("SMOKE OK");
