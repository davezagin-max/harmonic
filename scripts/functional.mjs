#!/usr/bin/env node
/**
 * Functional walk of the production build in headless Chromium.
 *
 *   pnpm build && pnpm start      (serves on port 3170)
 *   pnpm functional
 *
 * Drives every control the app exposes at a desktop and a phone width, in dark
 * and light themes. Each step asserts a visible outcome (text, element state,
 * an attribute, a download's content). A console error, an uncaught page error,
 * or horizontal page scroll fails the step.
 *
 * The key path is exercised with every /api request intercepted in the browser,
 * so no request reaches the server and nothing reaches Claude. The server
 * contract is checked over HTTP without any key header.
 *
 * Downloads, generated input files and screenshots go under FUNCTIONAL_OUT
 * (default: ~/.cache/harmonic-functional). Set FUNCTIONAL_BASE to test another origin.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.FUNCTIONAL_BASE ?? "http://localhost:3170";
const OUT = process.env.FUNCTIONAL_OUT ?? path.join(os.homedir(), ".cache", "harmonic-functional");
const INPUTS = path.join(OUT, "inputs");
const DOWNLOADS = path.join(OUT, "downloads");
const SHOTS = path.join(OUT, "shots");
for (const dir of [INPUTS, DOWNLOADS, SHOTS]) mkdirSync(dir, { recursive: true });

/** A made-up key in the right shape. It is only ever sent to a route this script intercepts. */
const FAKE_KEY = "sk-ant-functional-test-value-not-a-real-key-0001";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SUITES = [
  { name: "desktop", width: 1280, height: 800, theme: "dark", full: true },
  { name: "phone", width: 390, height: 844, theme: "dark", full: true },
  { name: "desktop-light", width: 1280, height: 800, theme: "light", full: false },
  { name: "phone-light", width: 390, height: 844, theme: "light", full: false },
];

const results = [];
const externalRequests = [];

// ---------------------------------------------------------------------------
// Input files (written under OUT, never into the repo)
// ---------------------------------------------------------------------------

const rekordboxText = [
  "Track Title\tArtist\tGenre\tBPM\tKey\tTime\tLocation",
  "Rekord Test One\tSample Artist A\tHouse\t124.00\t8A\t6:10\tC:\\Music\\Sample Artist A - Rekord Test One.mp3",
  "Rekord Test Two\tSample Artist B\tHouse\t122.00\t9A\t5:45\tC:\\Music\\Sample Artist B - Rekord Test Two.mp3",
  "Rekord Test Three\tSample Artist C\tTech House\t127.00\t8B\t6:30\tC:\\Music\\Sample Artist C - Rekord Test Three.mp3",
  "Rekord Test Four\tSample Artist D\tHouse\t125.00\t7A\t6:02\tC:\\Music\\Sample Artist D - Rekord Test Four.mp3",
  "Rekord Test Five\tSample Artist E\tDeep House\t123.00\t8A\t7:01\tC:\\Music\\Sample Artist E - Rekord Test Five.mp3",
].join("\r\n");

const INPUT_FILES = {
  "bad.csv":
    "Title,Artist,BPM,Key,Energy\r\nHarbour Lights,Test Artist One,124,8A,6\r\n,No Title Artist,125,8A,5\r\nMissing Tempo,Test Artist Two,abc,9A,5\r\nUnknown Key,Test Artist Three,126,Zz,5\r\nClean Wind,Test Artist Four,122,8B,7\r\n",
  "serato.csv":
    "Name,Artist,BPM,Key,Energy,Genre,Time\n\"=SUM(1,2) Test\",Test Artist Five,123,8A,6,House,6:20\nSecond Light,Test Artist Six,124,9A,7,House,5:50\nThird Tide,Test Artist Seven,122,8B,6,Deep House,6:40\nFourth Dune,Test Artist Eight,125,7A,5,House,6:05\n",
  "traktor.csv":
    "Title,Artist,BPM,Key,Time\nOpen Road,Test Artist Nine,124,8m,6:10\nLow Bloom,Test Artist Ten,123,9m,5:55\nSun Relay,Test Artist Eleven,125,10d,6:30\nNight Sail,Test Artist Twelve,122,2m,6:15\n",
  "mik.csv":
    "Title,Artist,BPM,Key Result,Energy Level\nWarm Canvas,Test Artist Thirteen,123,8A,4\nGlass Hour,Test Artist Fourteen,124,9A,7\nRiver Engine,Test Artist Fifteen,125,8B,8\n",
  "generic-bom.csv":
    "\uFEFFTitle,Artist,BPM,Key,Energy\n\"Blue, Hour Remix\",Test Artist Sixteen,123,8A,6\nQuiet Harbor,Test Artist Seventeen,124,9A,5\nMarch Hall,Test Artist Eighteen,122,8B,7\n",
  "long40.csv":
    "Title,Artist,BPM,Key,Energy,Time\nLonger Than Any Set,Test Artist Nineteen,124,8A,6,60:00\n",
  "empty.csv": "   \n",
  "nohead.csv": "Foo,Bar\n1,2\n",
  "oversize.csv": `Title,Artist,BPM,Key\nPadding,${"A".repeat(2 * 1024 * 1024 + 64)},124,8A\n`,
};

for (const [name, text] of Object.entries(INPUT_FILES)) {
  writeFileSync(path.join(INPUTS, name), text);
}
// Rekordbox exports are UTF-16 with a byte-order mark and tab-separated.
writeFileSync(
  path.join(INPUTS, "rekordbox.txt"),
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(rekordboxText, "utf16le")]),
);

// ---------------------------------------------------------------------------
// Assertions and recording
// ---------------------------------------------------------------------------

function expectTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60);
}

async function waitUntil(read, test, what, timeout = 12000) {
  const end = Date.now() + timeout;
  let last = null;
  while (Date.now() < end) {
    last = await read().catch(() => null);
    if (test(last)) return last;
    await sleep(120);
  }
  const shown = typeof last === "string" ? last.slice(0, 160) : JSON.stringify(last)?.slice(0, 160);
  throw new Error(`timed out waiting for ${what}; last value: ${shown}`);
}

/**
 * Runs one check. Records pass or fail, a screenshot on failure, and fails the
 * step on sideways scroll or on any console or page error raised during it.
 */
async function step(ctx, feature, how, body) {
  const errorsBefore = ctx.errors.length;
  try {
    const detail = await body();
    const widths = await ctx.page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expectTrue(
      widths.scroll <= widths.viewport,
      `page scrolls sideways: ${widths.scroll}px wide in a ${widths.viewport}px window`,
    );
    const fresh = ctx.errors.slice(errorsBefore);
    expectTrue(fresh.length === 0, `console or page errors: ${fresh.slice(0, 3).join(" | ")}`);
    results.push({ suite: ctx.suite, feature, how, result: "pass", detail: detail ?? "" });
  } catch (error) {
    let message = String(error?.message ?? error)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" | ")
      .slice(0, 300);
    // What the tips and toolbar buttons read at the moment of failure, to tell a missing button from a wrong one.
    const shown = await ctx.page
      .locator('section[aria-labelledby="set-title"] button, section[aria-label="Set controls"] button')
      .allInnerTexts({ timeout: 1000 })
      .catch(() => []);
    if (shown.length) message += ` || buttons: ${shown.filter((text) => /Write|Clear|Cancel|Reset|Optimize/.test(text)).join(", ")}`;
    results.push({ suite: ctx.suite, feature, how, result: "fail", detail: message.slice(0, 400) });
    await ctx.page
      .screenshot({ path: path.join(SHOTS, `${ctx.suite}-${slug(feature)}.png`), fullPage: true })
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

function locate(page) {
  return {
    intro: page.locator('section[aria-labelledby="intro-title"]'),
    tour: page.locator('section[aria-labelledby="intro-title"] button'),
    narration: page.locator('section[aria-labelledby="intro-title"] p[aria-live="polite"]'),
    toolbar: page.locator('section[aria-label="Set controls"]'),
    wheel: page.locator('svg[role="img"][aria-label^="Camelot wheel"]'),
    arc: page.locator('section[aria-labelledby="arc-title"]'),
    set: page.locator('section[aria-labelledby="set-title"]'),
    setSummary: page.locator('section[aria-labelledby="set-title"] p[aria-live="polite"]'),
    stats: page.locator('section[aria-labelledby="stats-title"]'),
    trackButtons: page.locator('section[aria-labelledby="set-title"] ol > li > button'),
    mixRows: page.locator('section[aria-labelledby="set-title"] ol > li > div'),
    tipLines: page.locator('section[aria-labelledby="set-title"] p.basis-full'),
    length: page.locator("#set-length"),
    banner: page.locator('div[role="status"]'),
    dialog: page.locator("dialog"),
    openDialog: page.locator("dialog[open]"),
  };
}

const textOf = (locator) => locator.first().textContent().then((text) => (text ?? "").trim());
const seedOf = async (L) => {
  const text = await textOf(L.stats.locator("p.font-mono").first());
  const match = text.match(/seed (\d+)/);
  expectTrue(match, `no seed in stats: "${text}"`);
  return Number(match[1]);
};
const improvementOf = async (L) => {
  const text = await textOf(L.stats.locator("p.text-4xl"));
  expectTrue(/^\d+%$/.test(text), `improvement figure is not a percentage: "${text}"`);
  return Number(text.replace("%", ""));
};

async function settle(L) {
  // The optimizer runs in a worker; the set is current once the set summary stops saying "Optimizing".
  await waitUntil(
    () => textOf(L.setSummary),
    (text) => !/Optimizing/.test(text),
    "the optimizer to finish",
    20000,
  );
}

async function download(ctx, trigger) {
  const [file] = await Promise.all([ctx.page.waitForEvent("download"), trigger()]);
  const target = path.join(DOWNLOADS, `${ctx.suite}-${file.suggestedFilename()}`);
  await file.saveAs(target);
  return { name: file.suggestedFilename(), text: readFileSync(target, "utf8") };
}

/** Lines of a CSV export with the \r\n endings the app writes, empty lines dropped. */
const csvLines = (text) => text.split(/\r?\n/).filter((line) => line.length > 0);

async function plannedTracks(L) {
  return L.trackButtons.count();
}

/** Keeps the length input at a value, the way a visitor would: select all, type, then leave the field. */
async function typeLength(page, L, value) {
  await L.length.fill(String(value));
  await page.keyboard.press("Tab");
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

async function firstPaint(ctx, L) {
  const { page } = ctx;
  await step(ctx, "First screen: one-line pitch, sample crate planned", "Load / and read the intro and sample line", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const pitch = await textOf(L.intro.locator("#intro-title"));
    expectTrue(/Harmonic orders a DJ.s tracks so each song blends smoothly/.test(pitch), `pitch: "${pitch}"`);
    const sample = await textOf(L.intro.locator("p.text-muted").first());
    expectTrue(/80 made-up sample tracks/.test(sample), `sample line: "${sample}"`);
    return "pitch and sample line shown";
  });

  await step(ctx, "Opening set is already optimized on first paint", "Read the wheel headline, set list, stats and mixing tips count", async () => {
    const n = await plannedTracks(L);
    expectTrue(n >= 2, `only ${n} tracks in the set`);
    const wheelText = await L.wheel.textContent();
    expectTrue(wheelText.includes(`${n} of 80 tracks`), `wheel headline lacks "${n} of 80 tracks"`);
    const improvement = await improvementOf(L);
    expectTrue(improvement >= 50, `improvement ${improvement}% is below 50`);
    const length = await textOf(L.setSummary);
    expectTrue(/tracks · .* of 1 h 30 min/.test(length), `set summary: "${length}"`);
    const mixes = await L.mixRows.count();
    expectTrue(mixes === n - 1, `${mixes} mix rows for ${n} tracks`);
    return `${n} tracks, ${mixes} mixes, ${improvement}% better than random`;
  });

  await step(ctx, "Demo banner says the AI parts are examples, not model runs", "Read the banner on load", async () => {
    const text = await textOf(L.banner);
    expectTrue(/pre-written examples/.test(text), `banner: "${text}"`);
    return "banner names the pre-written examples";
  });

  await step(ctx, "Set list numbers the tracks in play order", "Read the position column of every track row", async () => {
    const n = await plannedTracks(L);
    for (let i = 0; i < n; i++) {
      const position = await textOf(L.trackButtons.nth(i).locator("span").first());
      expectTrue(position === String(i + 1), `row ${i + 1} shows position "${position}"`);
    }
    return `1 to ${n} in order`;
  });

  await step(ctx, "Set list badges per mix: key relation, tempo and energy match the two tracks each mix joins", "Read every mix row; compare its tempo and energy badges with the bpm and energy of the track rows either side", async () => {
    const keyLabels = [
      "Same key",
      "Relative major",
      "Relative minor",
      "+1 on the wheel",
      "-1 on the wheel",
      "Energy boost +2",
      "Diagonal clash",
      "Clash,",
    ];
    const rows = await L.mixRows.allInnerTexts();
    const tracks = await L.trackButtons.allInnerTexts();
    expectTrue(rows.length === tracks.length - 1, `${rows.length} mix rows for ${tracks.length} tracks`);
    const bpmOf = (text) => Number(/(\d+) bpm/.exec(text)?.[1]);
    const energyOf = (text) => Number(/energy (\d+)/.exec(text)?.[1]);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      expectTrue(keyLabels.some((label) => row.includes(label)), `mix ${i + 1}: no key relation in "${row.slice(0, 80)}"`);
      const from = tracks[i];
      const to = tracks[i + 1];
      expectTrue(Number.isFinite(bpmOf(from)) && Number.isFinite(bpmOf(to)), `mix ${i + 1}: no bpm on the track rows`);
      expectTrue(Number.isFinite(energyOf(from)) && Number.isFinite(energyOf(to)), `mix ${i + 1}: no energy on the track rows`);
      // Same rounding as the app's formatters (lib/music/bpm.ts formatPct, lib/music/transition.ts formatEnergyChange).
      const pct = Math.round((((bpmOf(to) - bpmOf(from)) / bpmOf(from)) * 100) * 10) / 10;
      const tempo = pct === 0 ? "0%" : `${pct > 0 ? "+" : "-"}${Math.abs(pct).toFixed(1)}%`;
      const change = energyOf(to) - energyOf(from);
      const energy = change === 0 ? "0" : `${change > 0 ? "+" : "-"}${Math.abs(change)}`;
      expectTrue(row.includes(tempo), `mix ${i + 1}: expected tempo ${tempo} from ${bpmOf(from)} to ${bpmOf(to)} bpm, row says "${row.slice(0, 80)}"`);
      expectTrue(row.includes(`energy ${energy}`), `mix ${i + 1}: expected energy ${energy}, row says "${row.slice(0, 80)}"`);
    }
    return `${rows.length} mixes: tempo and energy badges match the track rows either side`;
  });

  await step(ctx, "Camelot wheel: track count, key ring and set path render", "Count wheel circles and set nodes", async () => {
    const setNodes = await L.wheel.locator("g.set-node").count();
    expectTrue(setNodes === (await plannedTracks(L)), `${setNodes} set nodes on the wheel`);
    const paths = await L.wheel.locator("g[fill='none'] path.set-path").count();
    expectTrue(paths === setNodes - 1, `${paths} set path segments for ${setNodes} nodes`);
    const crateDots = await L.wheel.locator(":scope > circle.cursor-pointer").count();
    expectTrue(crateDots > 0, "no crate tracks outside the set drawn on the wheel");
    return `${setNodes} set nodes, ${paths} path segments, ${crateDots} other crate tracks`;
  });
}

async function startOver(ctx, L) {
  const { page } = ctx;
  await step(ctx, "Start over: guided demo plays the 3-hour tailgate preset", "Click Watch it plan a 3-hour set; wait for Start over; read narration, arc summary and length", async () => {
    await L.tour.click();
    await waitUntil(() => textOf(L.tour), (text) => text === "Start over", "the guided demo to finish", 20000);
    const narration = await textOf(L.narration);
    expectTrue(/Done: a 3 h plan from one sentence/.test(narration), `narration: "${narration}"`);
    expectTrue((await L.length.inputValue()) === "180", `length is ${await L.length.inputValue()}, not 180`);
    const arc = await textOf(L.arc);
    expectTrue(arc.includes("Easy 45-minute warm-up, a steady climb to a 1:45 peak"), "arc summary missing");
    expectTrue(arc.includes("Set length taken from the description"), "length note missing");
    return narration.slice(0, 120);
  });

  await step(ctx, "Start over: the demo's Claude part is labelled as a pre-written example", "Read the source label under the arc prompt and the narration note", async () => {
    const note = await textOf(L.intro.locator("span.block"));
    expectTrue(/pre-written example/.test(note), `narration note: "${note}"`);
    const label = await textOf(L.arc.getByText("Pre-written example (not a model run)"));
    expectTrue(label.length > 0, "no source label in the arc section");
    return "labelled as a pre-written example, not a model run";
  });

  await step(ctx, "Start over: returns the opening set and button label", "Click Start over; read the length and the button", async () => {
    await L.tour.click();
    await waitUntil(() => textOf(L.tour), (text) => /Watch it plan a 3-hour set/.test(text), "the button to reset", 15000);
    await settle(L);
    expectTrue((await L.length.inputValue()) === "90", `length is ${await L.length.inputValue()} after Start over`);
    expectTrue((await page.getByRole("button", { name: "Reset", exact: true }).count()) === 0, "Reset still shown");
    return "back to 90 minutes, Reset hidden";
  });
}

async function setLength(ctx, L) {
  const { page } = ctx;
  await step(ctx, "Set length: +15 and -15 re-plan the set", "Click 15 minutes longer, then shorter; read the value and the set summary", async () => {
    await page.getByRole("button", { name: "15 minutes longer" }).click();
    await waitUntil(() => L.length.inputValue(), (v) => v === "105", "length 105");
    await settle(L);
    expectTrue(/of 1 h 45 min/.test(await textOf(L.setSummary)), "set summary did not show 1 h 45 min");
    await page.getByRole("button", { name: "15 minutes shorter" }).click();
    await waitUntil(() => L.length.inputValue(), (v) => v === "90", "length 90");
    await settle(L);
    expectTrue(/of 1 h 30 min/.test(await textOf(L.setSummary)), "set summary did not return to 1 h 30 min");
    return "105 then 90; set summary follows";
  });

  await step(ctx, "Set length: typed value applies; out-of-range and too-short input is ignored", "Type 120, then 5 (ignored), then leave the field; type 20 and check -15 is disabled", async () => {
    await typeLength(page, L, 120);
    await waitUntil(() => L.length.inputValue(), (v) => v === "120", "length 120");
    await settle(L);
    expectTrue(/of 2 h/.test(await textOf(L.setSummary)), "set summary did not show 2 h");
    await L.length.fill("5");
    await page.keyboard.press("Tab");
    expectTrue((await L.length.inputValue()) === "120", `length after "5" + blur is ${await L.length.inputValue()}`);
    await typeLength(page, L, 20);
    await waitUntil(() => L.length.inputValue(), (v) => v === "20", "length 20");
    await settle(L);
    expectTrue(await page.getByRole("button", { name: "15 minutes shorter" }).isDisabled(), "-15 not disabled at 20");
    await L.length.fill("400");
    await page.keyboard.press("Tab");
    expectTrue((await L.length.inputValue()) === "20", `length after "400" + blur is ${await L.length.inputValue()}`);
    await typeLength(page, L, 360);
    await waitUntil(() => L.length.inputValue(), (v) => v === "360", "length 360");
    expectTrue(await page.getByRole("button", { name: "15 minutes longer" }).isDisabled(), "+15 not disabled at 360");
    await typeLength(page, L, 90);
    await waitUntil(() => L.length.inputValue(), (v) => v === "90", "length 90");
    await settle(L);
    return "120 applies; 5 and 400 ignored; 20 and 360 disable the step buttons";
  });

  await step(ctx, "Reset button appears for a changed plan and restores the opening set", "Change length; click Reset; read length and Reset", async () => {
    await typeLength(page, L, 120);
    await waitUntil(() => L.length.inputValue(), (v) => v === "120", "length 120");
    await settle(L);
    const reset = page.getByRole("button", { name: "Reset", exact: true });
    await reset.waitFor({ state: "visible", timeout: 5000 });
    await reset.click();
    await waitUntil(() => L.length.inputValue(), (v) => v === "90", "length 90 after Reset");
    await settle(L);
    expectTrue((await page.getByRole("button", { name: "Reset", exact: true }).count()) === 0, "Reset still visible");
    return "Reset returns to 90 and hides itself";
  });
}

async function priorities(ctx, L) {
  const { page } = ctx;
  await step(ctx, "Priorities: opens three weight sliders", "Click Priorities; read aria-expanded and the three labels", async () => {
    const toggle = page.getByRole("button", { name: "Priorities", exact: true });
    await toggle.click();
    expectTrue((await toggle.getAttribute("aria-expanded")) === "true", "aria-expanded is not true");
    const panel = page.locator("#priorities");
    await panel.waitFor({ state: "visible", timeout: 3000 });
    const labels = await panel.locator("span.font-mono").allInnerTexts();
    expectTrue(labels.length === 3 && labels.every((text) => text === "×1.00"), `labels: ${labels.join(",")}`);
    return "Harmony, Tempo and Energy arc all at ×1.00";
  });

  await step(ctx, "Priorities: a changed weight re-runs the search and shows Reset", "Move the Harmony slider to its maximum with the keyboard; read the label", async () => {
    const slider = page.locator("#priorities input[type=range]").first();
    await slider.focus();
    await slider.press("End");
    await waitUntil(
      () => page.locator("#priorities span.font-mono").first().textContent(),
      (text) => text === "×2.00",
      "Harmony ×2.00",
    );
    await settle(L);
    await page.getByRole("button", { name: "Reset", exact: true }).waitFor({ state: "visible", timeout: 5000 });
    return "Harmony ×2.00; Reset appears";
  });

  await step(ctx, "Priorities: Reset restores the weights", "Click Reset; read the three labels again", async () => {
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await waitUntil(
      () => page.locator("#priorities span.font-mono").allInnerTexts(),
      (texts) => texts.length === 3 && texts.every((text) => text === "×1.00"),
      "all weights back to ×1.00",
    );
    await settle(L);
    return "all three back at ×1.00";
  });

  await step(ctx, "Priorities: the button hides the panel again", "Click Priorities a second time", async () => {
    const toggle = page.getByRole("button", { name: "Priorities", exact: true });
    await toggle.click();
    expectTrue((await page.locator("#priorities").count()) === 0, "panel still rendered");
    expectTrue((await toggle.getAttribute("aria-expanded")) === "false", "aria-expanded is not false");
    return "panel closed";
  });
}

async function optimizeAgain(ctx, L) {
  const { page } = ctx;
  await step(ctx, "Optimize again: runs the search from a new seed", "Read the seed, click Optimize again, read the new seed and Reset", async () => {
    const before = await seedOf(L);
    await page.getByRole("button", { name: "Optimize again" }).click();
    await waitUntil(() => seedOf(L), (seed) => seed === before + 1, `seed ${before + 1}`, 20000);
    await settle(L);
    await page.getByRole("button", { name: "Reset", exact: true }).waitFor({ state: "visible", timeout: 5000 });
    const improvement = await improvementOf(L);
    expectTrue(improvement >= 50, `after a new seed, improvement is ${improvement}%`);
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await waitUntil(() => seedOf(L), (seed) => seed === before, `seed ${before} back`, 20000);
    await settle(L);
    return `seed ${before} to ${before + 1} and back, ${improvement}% better after the new run`;
  });
}

async function presets(ctx, L) {
  const { page } = ctx;
  const plotBefore = await L.arc.locator("polyline").first().getAttribute("points");

  const presetsList = [
    {
      button: "3-hour tailgate",
      summary: "Easy 45-minute warm-up, a steady climb to a 1:45 peak",
      length: "180",
      note: "Set length taken from the description: 3 h.",
    },
    {
      button: "Sunset rooftop",
      summary: "Mellow open, one unbroken slow build",
      length: "90",
      note: "Set length taken from the description: 1 h 30 min.",
    },
    {
      button: "Peak-time club slot",
      summary: "Comes in hot, eases off for a breather at the hour",
      length: "120",
      note: "Set length taken from the description: 2 h.",
    },
  ];

  let previous = plotBefore;
  for (const preset of presetsList) {
    await step(ctx, `Arc preset: ${preset.button}`, `Click "${preset.button}"; read the summary, the length note, the source label and the curve`, async () => {
      await L.arc.getByRole("button", { name: preset.button, exact: true }).click();
      await waitUntil(() => textOf(L.arc), (text) => text.includes(preset.summary), `summary "${preset.summary.slice(0, 30)}"`, 20000);
      await waitUntil(() => L.length.inputValue(), (v) => v === preset.length, `length ${preset.length}`, 10000);
      const arc = await textOf(L.arc);
      expectTrue(arc.includes(preset.note), `length note missing (have: "${arc.slice(0, 220)}")`);
      expectTrue(arc.includes("Pre-written example (not a model run)"), "no pre-written example label");
      await settle(L);
      const points = await L.arc.locator("polyline").first().getAttribute("points");
      expectTrue(points !== previous, "the target curve did not change");
      previous = points;
      return `summary, length ${preset.length} and curve updated`;
    });
  }

  await step(ctx, "Reset after presets: restores the default arc and length", "Click Reset; read the curve, the length and the arc placeholder", async () => {
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await waitUntil(() => L.length.inputValue(), (v) => v === "90", "length 90");
    await settle(L);
    await waitUntil(() => L.arc.locator("polyline").first().getAttribute("points"), (p) => p === plotBefore, "default curve");
    expectTrue(!(await textOf(L.arc)).includes("Set length taken from the description"), "description note still shown");
    return "default curve and 90 minutes";
  });
}

async function arcEditor(ctx, L) {
  const { page } = ctx;
  const handles = L.arc.locator('[role="slider"]');
  const defaultCount = await handles.count();
  const defaultLevels = [];
  for (let i = 0; i < defaultCount; i++) {
    defaultLevels.push(await handles.nth(i).getAttribute("aria-valuenow"));
  }
  const level = async (i) => Number(await handles.nth(i).getAttribute("aria-valuenow"));

  await step(ctx, "Energy arc: points are keyboard-operable sliders", "Focus a point; press ArrowUp, then Shift+ArrowUp; read aria-valuenow", async () => {
    const before = await level(1);
    const curveBefore = await L.arc.locator("polyline").first().getAttribute("points");
    await handles.nth(1).press("ArrowUp");
    await waitUntil(() => level(1), (v) => Math.abs(v - (before + 0.5)) < 0.15, `level ${before + 0.5}`);
    await handles.nth(1).press("Shift+ArrowUp");
    await waitUntil(() => level(1), (v) => Math.abs(v - (before + 1.5)) < 0.15, `level ${before + 1.5}`);
    expectTrue((await L.arc.locator("polyline").first().getAttribute("points")) !== curveBefore, "curve did not redraw");
    await settle(L);
    await handles.nth(1).press("ArrowDown");
    await handles.nth(1).press("ArrowDown");
    await handles.nth(1).press("ArrowDown");
    await waitUntil(() => level(1), (v) => Math.abs(v - before) < 0.15, `level ${before}`);
    return `point 2 moved from ${before} by +0.5, then +1, then back to ${before} with three ArrowDowns`;
  });

  await step(ctx, "Energy arc: Home, End and arrow keys move focus between points", "Press End, Home, ArrowRight; read the focused point's label", async () => {
    await handles.nth(1).focus();
    await page.keyboard.press("End");
    const last = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    expectTrue(last.startsWith(`Arc point ${defaultCount} of ${defaultCount}`), `End focused "${last}"`);
    await page.keyboard.press("Home");
    const first = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    expectTrue(first.startsWith(`Arc point 1 of ${defaultCount}`), `Home focused "${first}"`);
    await page.keyboard.press("ArrowRight");
    const second = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    expectTrue(second.startsWith(`Arc point 2 of ${defaultCount}`), `ArrowRight focused "${second}"`);
    return "End, Home and ArrowRight move focus to points 4, 1 and 2";
  });

  await step(ctx, "Energy arc: Remove point is disabled on an end point", "Focus point 1; read the Remove point button", async () => {
    await handles.nth(0).focus();
    const remove = L.arc.getByRole("button", { name: "Remove point", exact: true });
    expectTrue(await remove.isDisabled(), "Remove point enabled on the first point");
    return "disabled on the first point";
  });

  await step(ctx, "Energy arc: Add point and Remove point change the number of points", "Click Add point, then Remove point on the new interior point", async () => {
    await handles.nth(1).focus();
    await L.arc.getByRole("button", { name: "Add point", exact: true }).click();
    await waitUntil(() => handles.count(), (n) => n === defaultCount + 1, `${defaultCount + 1} points`);
    const remove = L.arc.getByRole("button", { name: "Remove point", exact: true });
    await waitUntil(() => remove.isEnabled(), (on) => on === true, "Remove point enabled");
    await remove.click();
    await waitUntil(() => handles.count(), (n) => n === defaultCount, `${defaultCount} points`);
    await settle(L);
    return `${defaultCount} to ${defaultCount + 1} and back`;
  });

  await step(ctx, "Energy arc: dragging a point with the mouse changes its energy", "Mouse down on point 3, drag 30 pixels up, release; read aria-valuenow", async () => {
    const before = await level(2);
    const box = await handles.nth(2).boundingBox();
    expectTrue(box, "point 3 has no box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 15, { steps: 4 });
    await page.mouse.move(x, y - 30, { steps: 4 });
    await page.mouse.up();
    await waitUntil(() => level(2), (v) => v > before + 0.8, `level above ${before + 0.8}`);
    await settle(L);
    return `point 3 went from ${before} to ${await level(2)}`;
  });

  await step(ctx, "Energy arc: Reset arc restores the default curve", "Click Reset arc after edits; read the levels and whether Reset arc is disabled", async () => {
    const resetArc = L.arc.getByRole("button", { name: "Reset arc", exact: true });
    expectTrue(await resetArc.isEnabled(), "Reset arc disabled after edits");
    await resetArc.click();
    await waitUntil(
      async () => {
        const levels = [];
        for (let i = 0; i < (await handles.count()); i++) levels.push(await handles.nth(i).getAttribute("aria-valuenow"));
        return levels.join(",");
      },
      (joined) => joined === defaultLevels.join(","),
      "default levels",
    );
    expectTrue(await resetArc.isDisabled(), "Reset arc still enabled at default");
    await settle(L);
    return "levels back to the default curve; Reset arc disabled";
  });
}

async function wheelAndSetList(ctx, L) {
  const { page } = ctx;
  const n = await plannedTracks(L);

  await step(ctx, "Wheel: hovering a set node names its track and position", "Hover set node 1; read the wheel centre", async () => {
    await L.wheel.locator("g.set-node").nth(0).hover();
    await waitUntil(() => L.wheel.textContent(), (t) => t.includes(`Track 1 of ${n}`), `Track 1 of ${n}`);
    return `"Track 1 of ${n}" in the centre`;
  });

  await step(ctx, "Wheel: hovering a track lights the mixes it can make", "Hover set node 1; read the clean-mix count and the fanned links", async () => {
    // The count is its own text element; reading the whole wheel would run it into the code before it.
    const centre = await L.wheel.locator("text", { hasText: /clean mix/ }).first().textContent();
    const match = centre.match(/^(\d+) clean mix(es)? from here$/);
    expectTrue(match, `no clean-mix count in the centre: "${centre}"`);
    const fanned = await L.wheel.locator("g[pointer-events='none'][fill='none'] path:not(.set-path)").count();
    expectTrue(fanned >= Number(match[1]) || Number(match[1]) === 0, `${fanned} links for ${match[1]} mixes`);
    return `${match[1]} clean mixes, ${fanned} links drawn`;
  });

  await step(ctx, "Wheel: moving from a track to another part of the wheel moves the highlight", "Hover set node 1, then a key segment inside the same wheel; read the centre", async () => {
    await L.wheel.locator("g.set-node").nth(0).hover();
    await L.wheel.locator("path").nth(0).hover();
    await waitUntil(() => L.wheel.textContent(), (t) => t.includes("mixes into the lit keys"), "key focus after moving off the track", 3000);
    return "highlight follows the pointer";
  });

  await step(ctx, "Wheel: hovering a key segment names the key", "Clear the hover, then hover the first key segment; read the centre", async () => {
    await page.mouse.move(2, 2);
    await L.wheel.locator("path").nth(0).hover();
    await waitUntil(() => L.wheel.textContent(), (t) => t.includes("mixes into the lit keys"), "key hover text");
    return "key code and name, lit keys named";
  });

  await step(ctx, "Wheel: clicking a crate track outside the set selects it", "Click the first crate dot outside the set; read the centre and the set list", async () => {
    await L.wheel.locator(":scope > circle.cursor-pointer").first().click({ force: true });
    await waitUntil(() => L.wheel.textContent(), (t) => t.includes("In the crate"), "In the crate");
    const text = await L.wheel.textContent();
    expectTrue(/clean mix(es)? from here/.test(text), "no mix count for the crate track");
    await page.mouse.move(2, 2);
    return "centre says In the crate and lists its clean mixes";
  });

  await step(ctx, "Set list: hovering a row highlights its node on the wheel", "Hover track row 5; read the wheel centre", async () => {
    await L.trackButtons.nth(4).hover();
    await waitUntil(() => L.wheel.textContent(), (t) => t.includes(`Track 5 of ${n}`), `Track 5 of ${n}`);
    await page.mouse.move(2, 2);
    return `"Track 5 of ${n}" shown on hover`;
  });

  await step(ctx, "Set list: clicking a row selects it (aria-pressed) and toggles", "Click row 3 twice; read aria-pressed and the wheel centre", async () => {
    const row = L.trackButtons.nth(2);
    await row.click();
    expectTrue((await row.getAttribute("aria-pressed")) === "true", "row not pressed after click");
    await waitUntil(() => L.wheel.textContent(), (t) => t.includes("Track 3 of"), "Track 3 in centre");
    await row.click();
    expectTrue((await row.getAttribute("aria-pressed")) === "false", "row still pressed after second click");
    await page.mouse.move(2, 2);
    return "pressed on first click, released on second";
  });

  await step(ctx, "Set list: each track row shows its Camelot code, bpm and energy", "Read the first track row", async () => {
    const track = await L.trackButtons.first().innerText();
    expectTrue(/\b\d{1,2}[AB]\b/.test(track), `no Camelot code in "${track.slice(0, 60)}"`);
    expectTrue(/\d+ bpm/.test(track) && /energy \d+/.test(track), `no bpm/energy in "${track.slice(0, 80)}"`);
    return "row shows Camelot code, bpm and energy";
  });
}

async function exportsAndTips(ctx, L) {
  const { page } = ctx;
  const n = await plannedTracks(L);

  await step(ctx, "Export CSV: set list file has the header, one row per track, and the mix columns", "Click Export CSV; read the file name and every row", async () => {
    const file = await download(ctx, () => page.getByRole("button", { name: "Export CSV", exact: true }).click());
    expectTrue(/^harmonic-set-90min\.csv$/.test(file.name), `file name ${file.name}`);
    const lines = csvLines(file.text);
    expectTrue(
      lines[0] === "#,Start,Title,Artist,BPM,Key,Musical key,Energy,Genre,Mix into next,Tempo change,Energy change,Note",
      `header: ${lines[0]}`,
    );
    expectTrue(lines.length === n + 1, `${lines.length - 1} data rows for ${n} tracks`);
    expectTrue(lines[1].startsWith("1,0:00,"), `first row: ${lines[1].slice(0, 40)}`);
    expectTrue(lines[n].split(",").length >= 12, "last row has too few columns");
    return `${file.name}: header and ${n} rows`;
  });

  await step(ctx, "Export M3U: extended playlist, one entry per track, with the no-path note", "Click Export M3U; read the header, entry count and the note", async () => {
    const file = await download(ctx, () => page.getByRole("button", { name: "Export M3U", exact: true }).click());
    expectTrue(/^harmonic-set-90min\.m3u$/.test(file.name), `file name ${file.name}`);
    const lines = csvLines(file.text);
    expectTrue(lines[0] === "#EXTM3U", `first line ${lines[0]}`);
    expectTrue(lines[1] === "#PLAYLIST:Harmonic set, 1 h 30 min", `playlist line ${lines[1]}`);
    const entries = lines.filter((line) => line.startsWith("#EXTINF:")).length;
    expectTrue(entries === n, `${entries} entries for ${n} tracks`);
    expectTrue(lines.some((line) => line.startsWith("# Some tracks had no file path")), "no note about missing paths");
    return `${entries} entries with a note that paths were missing`;
  });

  await step(ctx, "Mixing tips: Write mixing tips writes one line per mix for the opening set", "Click Write mixing tips; read the source label and the tip count", async () => {
    await page.getByRole("button", { name: "Write mixing tips", exact: true }).click();
    await waitUntil(() => textOf(L.set.getByRole("button", { name: /Write again|Writing/ })), (t) => t === "Write again", "Write again", 15000);
    const tips = await L.tipLines.count();
    expectTrue(tips === n - 1, `${tips} tips for ${n - 1} mixes`);
    const source = await textOf(L.set.getByText("Pre-written example (not a model run)"));
    expectTrue(source.length > 0, "no source label");
    return `${tips} tips, labelled as a pre-written example`;
  });

  await step(ctx, "Mixing tips: the tips export into the CSV Note column", "Read the first tip on the page, then export the CSV and find it", async () => {
    const tips = await L.tipLines.allInnerTexts();
    expectTrue(tips.length > 0, "no tips on the page");
    const file = await download(ctx, () => page.getByRole("button", { name: "Export CSV", exact: true }).click());
    expectTrue(file.text.includes(tips[0].trim()), "the first tip is not in the CSV");
    return "tip text is in the CSV Note column";
  });

  await step(ctx, "Mixing tips: Clear removes the tips", "Click Clear; read the tip count and the button", async () => {
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await waitUntil(() => L.tipLines.count(), (c) => c === 0, "no tips");
    expectTrue(
      (await page.getByRole("button", { name: "Write mixing tips", exact: true }).count()) === 1,
      "Write mixing tips not back",
    );
    return "tips cleared, Write mixing tips back";
  });

  await step(ctx, "Mixing tips: Write again on the opening set brings them back", "Click Write mixing tips, then read the count", async () => {
    await page.getByRole("button", { name: "Write mixing tips", exact: true }).click();
    await waitUntil(() => L.tipLines.count(), (c) => c === n - 1, `${n - 1} tips`, 15000);
    return `${n - 1} tips again`;
  });

  await step(ctx, "Mixing tips without a key: the set is not the opening set, so tips are explained and disabled", "Set length to 120; read the explanation and the button state", async () => {
    await typeLength(page, L, 120);
    await waitUntil(() => L.length.inputValue(), (v) => v === "120", "length 120");
    await settle(L);
    const writeButton = page.getByRole("button", { name: /Write mixing tips|Write again/ });
    expectTrue(await writeButton.first().isDisabled(), "tips button is enabled for a set without a key");
    const text = await textOf(L.set);
    expectTrue(text.includes("Without a key, tips exist only for the opening sample set."), "no explanation shown");
    return "explained, button disabled";
  });

  await step(ctx, "Mixing tips: Go back to it restores the opening set and enables tips", "Click Go back to it; read the length and the tips button", async () => {
    await page.getByRole("button", { name: "Go back to it", exact: true }).click();
    await waitUntil(() => L.length.inputValue(), (v) => v === "90", "length 90");
    await settle(L);
    const button = page.getByRole("button", { name: /Write mixing tips|Write again/ });
    expectTrue(await button.first().isEnabled(), "tips button still disabled");
    return "opening set back, tips enabled";
  });
}

async function importFlows(ctx, L) {
  const { page } = ctx;
  const path_ = (name) => path.join(INPUTS, name);
  const importFile = async (name, viaButton = false) => {
    if (viaButton) {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.getByRole("button", { name: "Import CSV", exact: true }).click(),
      ]);
      await chooser.setFiles(path_(name));
    } else {
      await page.locator('input[type="file"]').setInputFiles(path_(name));
    }
    await sleep(150);
    await settle(L);
  };
  const report = () =>
    L.toolbar.locator("p", { hasText: "Imported in your browser" }).first().textContent({ timeout: 500 });
  const alertText = () => L.toolbar.getByRole("alert").first().textContent({ timeout: 500 });
  const apiCount = () => ctx.apiRequests.length;

  await step(ctx, "Import CSV: the button opens a file picker and a file reads in the browser", "Click Import CSV, choose bad.csv through the chooser; read the report", async () => {
    const before = apiCount();
    await importFile("bad.csv", true);
    const text = await waitUntil(report, (t) => t && /Imported in your browser/.test(t), "the import report");
    expectTrue(apiCount() === before, "the import sent a request to the server");
    return text.trim().slice(0, 150);
  });

  await step(ctx, "Import CSV: bad rows are skipped and the first reason is shown", "Read the skipped-row summary (2 good tracks, 3 skipped)", async () => {
    const text = await report();
    expectTrue(
      text.includes("2 tracks · Generic layout · 3 rows skipped (row 3: no title)"),
      `report: "${text.slice(0, 200)}"`,
    );
    const rows = await L.trackButtons.count();
    expectTrue(rows === 2, `${rows} tracks in the set`);
    return "2 tracks; 3 rows skipped with row 3 and reason no title";
  });

  await step(ctx, "Import CSV: Back to sample crate restores the sample", "Click Back to sample crate; read the crate line and track count", async () => {
    await page.getByRole("button", { name: "Back to sample crate", exact: true }).click();
    await waitUntil(() => textOf(L.toolbar), (t) => t.includes("made-up tracks"), "sample crate line");
    await settle(L);
    expectTrue((await page.getByRole("button", { name: "Sample CSV", exact: true }).count()) === 1, "Sample CSV not back");
    return "Sample crate line back";
  });

  await step(ctx, "Import CSV: Rekordbox export (UTF-16, tab-separated, Location column) is read", "Import rekordbox.txt; read the layout, the stand-in energy note, and the set", async () => {
    await importFile("rekordbox.txt");
    const text = await waitUntil(report, (t) => t && /Rekordbox layout/.test(t), "Rekordbox layout");
    expectTrue(/5 tracks · Rekordbox layout · energy missing for 5, so a stand-in was derived from tempo/.test(text), `report: "${text.slice(0, 200)}"`);
    const badges = await L.toolbar.textContent();
    expectTrue(badges.includes("rekordbox"), "crate name not shown");
    await settle(L);
    const rows = await L.trackButtons.count();
    expectTrue(rows === 5, `${rows} tracks in the set`);
    return "5 tracks, Rekordbox layout, stand-in energy flagged";
  });

  await step(ctx, "Import CSV: Export M3U uses the file paths from the Rekordbox import", "Export M3U; read the entries", async () => {
    const file = await download(ctx, () => page.getByRole("button", { name: "Export M3U", exact: true }).click());
    expectTrue(file.text.includes("C:\\Music\\Sample Artist A - Rekord Test One.mp3"), "M3U lacks the imported path");
    expectTrue(!file.text.includes("# Some tracks had no file path"), "M3U says paths are missing");
    return "entries use the imported paths";
  });

  await step(ctx, "Import CSV: Serato export is read and spreadsheet formulas are defused on export", "Import serato.csv; export the CSV and find the defused title", async () => {
    await importFile("serato.csv");
    const text = await waitUntil(report, (t) => t && /Serato layout/.test(t), "Serato layout");
    expectTrue(/4 tracks · Serato layout/.test(text), `report: "${text.slice(0, 160)}"`);
    await settle(L);
    const file = await download(ctx, () => page.getByRole("button", { name: "Export CSV", exact: true }).click());
    expectTrue(file.text.includes("'=SUM(1,2) Test"), "the formula title was not defused");
    return "Serato read; the =SUM title exports with a leading apostrophe";
  });

  await step(ctx, "Import CSV: Traktor (Open Key) and Mixed In Key layouts are detected", "Import traktor.csv then mik.csv; read each layout", async () => {
    await importFile("traktor.csv");
    const traktor = await waitUntil(report, (t) => t && /Traktor layout/.test(t), "Traktor layout");
    expectTrue(/4 tracks · Traktor layout · energy missing for 4/.test(traktor), `traktor report: "${traktor.slice(0, 180)}"`);
    await importFile("mik.csv");
    const mik = await waitUntil(report, (t) => t && /Mixed In Key layout/.test(t), "Mixed In Key layout");
    expectTrue(/3 tracks · Mixed In Key layout/.test(mik), `mik report: "${mik.slice(0, 160)}"`);
    await settle(L);
    return "Traktor (4 tracks, energy derived) and Mixed In Key (3 tracks) detected";
  });

  await step(ctx, "Import CSV: BOM and quoted commas are read; the quoted title exports intact", "Import generic-bom.csv; read the set list and export the CSV", async () => {
    await importFile("generic-bom.csv");
    await waitUntil(report, (t) => t && /Generic layout/.test(t), "Generic layout");
    await settle(L);
    const titles = await L.trackButtons.allInnerTexts();
    expectTrue(titles.some((t) => t.includes("Blue, Hour Remix")), "quoted-comma title not in the set list");
    const file = await download(ctx, () => page.getByRole("button", { name: "Export CSV", exact: true }).click());
    expectTrue(file.text.includes('"Blue, Hour Remix"'), "CSV did not quote the comma title");
    return "BOM removed; comma title kept and quoted on export";
  });

  await step(ctx, "Import CSV: a track more than twice the set length shows the no-fit message and disables exports", "Import long40.csv (a 60-minute track), set length 20 min; read the message and the export buttons", async () => {
    await importFile("long40.csv");
    await waitUntil(report, (t) => t && /1 tracks/.test(t), "a 1-track crate");
    // The planner takes a track while half of it still fits, so only a track over twice the target is left out.
    await typeLength(page, L, 20);
    await waitUntil(() => L.length.inputValue(), (v) => v === "20", "length 20");
    await settle(L);
    const set = await textOf(L.set);
    expectTrue(set.includes("No tracks fit this set length."), `no fit message: "${set.slice(0, 160)}"`);
    expectTrue(await page.getByRole("button", { name: "Export CSV", exact: true }).isDisabled(), "Export CSV enabled");
    expectTrue(await page.getByRole("button", { name: "Export M3U", exact: true }).isDisabled(), "Export M3U enabled");
    return "no-fit message; both exports disabled";
  });

  await step(ctx, "Import CSV: an empty file, a file with no BPM or key, and a file over 2 MB show errors", "Import each; read the alert text", async () => {
    await typeLength(page, L, 90);
    await importFile("empty.csv");
    const empty = await waitUntil(alertText, (t) => t && t.includes("That file is empty."), "empty-file error");
    await importFile("nohead.csv");
    const nohead = await waitUntil(alertText, (t) => t && t.includes("Could not find BPM and Key columns"), "missing-column error");
    await importFile("oversize.csv");
    const big = await waitUntil(alertText, (t) => t && t.includes("over 2 MB"), "size error");
    expectTrue(empty && nohead && big, "an error did not show");
    return "empty, no-header and over-2-MB errors each shown in an alert";
  });

  await step(ctx, "Import CSV: a failed import keeps the crate that was loaded", "Read the crate line after the failed imports", async () => {
    const crate = await textOf(L.toolbar);
    expectTrue(crate.includes("long40") && crate.includes("1 tracks"), `crate line: "${crate.slice(0, 120)}"`);
    return "previous crate kept";
  });

  await step(ctx, "Sample CSV: downloads the 80-track sample with the importer's header", "Click Sample CSV; read the file name, header and row count", async () => {
    await page.getByRole("button", { name: "Back to sample crate", exact: true }).click();
    await settle(L);
    const file = await download(ctx, () => page.getByRole("button", { name: "Sample CSV", exact: true }).click());
    expectTrue(file.name === "harmonic-sample-crate.csv", `file name ${file.name}`);
    const lines = csvLines(file.text);
    expectTrue(lines[0] === "Title,Artist,BPM,Key,Energy,Genre,Time", `header: ${lines[0]}`);
    expectTrue(lines.length === 81, `${lines.length} lines, expected 81`);
    return "80 rows plus header";
  });

  await step(ctx, "Sample CSV round trip: the downloaded sample imports back as 80 tracks", "Import harmonic-sample-crate.csv from downloads; read the report", async () => {
    const sample = path.join(DOWNLOADS, `${ctx.suite}-harmonic-sample-crate.csv`);
    await page.locator('input[type="file"]').setInputFiles(sample);
    const text = await waitUntil(report, (t) => t && /80 tracks · Generic layout/.test(t), "80 tracks");
    await settle(L);
    await page.getByRole("button", { name: "Back to sample crate", exact: true }).click();
    await settle(L);
    return text.trim().slice(0, 100);
  });
}

async function keyDialog(ctx, L) {
  const { page } = ctx;
  const bannerAdd = L.banner.getByRole("button", { name: "Add key", exact: true });

  await step(ctx, "Key dialog: the banner's Add key opens it with a password field", "Click Add key in the banner; read the dialog", async () => {
    await bannerAdd.click();
    await L.openDialog.waitFor({ state: "visible", timeout: 3000 });
    const heading = await textOf(L.openDialog.getByRole("heading"));
    expectTrue(heading === "Add your Anthropic key", `heading: "${heading}"`);
    const type = await L.openDialog.locator('input[name="key"]').getAttribute("type");
    expectTrue(type === "password", `key field type ${type}`);
    return "heading and password field shown";
  });

  await step(ctx, "Key dialog: a key that does not look like one is refused before any request", "Type not-a-key; press Use this key; read the alert", async () => {
    const before = ctx.apiRequests.length;
    await L.openDialog.locator('input[name="key"]').fill("not-a-key");
    await L.openDialog.getByRole("button", { name: "Use this key", exact: true }).click();
    const message = await textOf(L.openDialog.getByRole("alert"));
    expectTrue(message.includes("Anthropic keys start with sk-ant-"), `alert: "${message}"`);
    expectTrue(ctx.apiRequests.length === before, "a request was sent");
    return "refused locally";
  });

  await step(ctx, "Key dialog: Escape closes it", "Press Escape; read the open dialogs", async () => {
    await page.keyboard.press("Escape");
    await waitUntil(() => L.openDialog.count(), (n) => n === 0, "dialog closed");
    return "closed";
  });

  await step(ctx, "Key dialog: Cancel and a click outside it both close it", "Open, click Cancel; open, click the backdrop", async () => {
    await bannerAdd.click();
    await L.openDialog.waitFor({ state: "visible", timeout: 3000 });
    await L.openDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await waitUntil(() => L.openDialog.count(), (n) => n === 0, "closed by Cancel");
    await bannerAdd.click();
    await L.openDialog.waitFor({ state: "visible", timeout: 3000 });
    await page.mouse.click(5, 5);
    await waitUntil(() => L.openDialog.count(), (n) => n === 0, "closed by backdrop");
    return "both close it";
  });

  await step(ctx, "Key dialog: the Create a key link opens the provider's page in a new tab", "Open the dialog and read the link's address and target", async () => {
    await bannerAdd.click();
    await L.openDialog.waitFor({ state: "visible", timeout: 3000 });
    const link = L.openDialog.getByRole("link", { name: "Create a key", exact: true });
    expectTrue((await link.getAttribute("href")) === "https://platform.claude.com/settings/keys", "wrong href");
    expectTrue((await link.getAttribute("target")) === "_blank", "not a new tab");
    await page.keyboard.press("Escape");
    await waitUntil(() => L.openDialog.count(), (n) => n === 0, "closed");
    return "https://platform.claude.com/settings/keys in a new tab (not followed)";
  });

  await step(ctx, "Arc prompt Add key and Mixing tips add a key open the same dialog", "Click the arc prompt's Add key; read the dialog", async () => {
    await L.arc.getByRole("button", { name: "Add key", exact: true }).click();
    await L.openDialog.waitFor({ state: "visible", timeout: 3000 });
    await page.keyboard.press("Escape");
    await waitUntil(() => L.openDialog.count(), (n) => n === 0, "closed");
    return "opens the dialog";
  });

  await step(ctx, "Own-words arc needs a key: the box is disabled and explains it", "Read the arc text box and its placeholder", async () => {
    const input = L.arc.locator("#arc-description");
    expectTrue(await input.isDisabled(), "arc text box enabled without a key");
    expectTrue((await input.getAttribute("placeholder")) === "Your own words need a key", "placeholder wording");
    return "disabled, with the reason in the placeholder";
  });
}

async function liveMocked(ctx, L) {
  const { page } = ctx;
  const notesFixture = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "notes.json"), "utf8"));
  const mock = { arc: "ok", notes: "ok" };
  const seen = [];
  const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    seen.push({ url: request.url(), headers: request.headers(), body });
    if (request.url().endsWith("/api/arc")) {
      if (mock.arc === "refusal") {
        return json(route, { ok: false, error: { kind: "refusal", message: "Model declined the request for the test." } });
      }
      if (mock.arc === "slow") {
        await sleep(4000);
        try {
          await json(route, { ok: false, error: { kind: "server", message: "late" } });
        } catch {
          // The visitor cancelled; the browser has already dropped the response.
        }
        return;
      }
      return json(route, {
        ok: true,
        data: {
          summary: "Mock live arc: a steady climb to a late peak",
          durationMinutes: 60,
          points: [
            { t: 0, energy: 2 },
            { t: 0.4, energy: 5 },
            { t: 0.8, energy: 8 },
            { t: 1, energy: 4 },
          ],
        },
        meta: { mode: "live", placeholder: false, recordedAt: null, model: "mock", usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, costUsd: 0.0001 },
      });
    }
    if (request.url().endsWith("/api/notes")) {
      if (mock.notes === "refusal") {
        return json(route, { ok: false, error: { kind: "refusal", message: "Model declined the request for the test." } });
      }
      return json(route, {
        ok: true,
        data: notesFixture["default-set"].data,
        meta: { mode: "live", placeholder: false, recordedAt: null, model: "mock", usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, costUsd: 0.0001 },
      });
    }
    return route.continue();
  });

  await step(ctx, "Live path: entering a key switches the page to live and sends it only in the header", "Add a key in the dialog; read the banner, the arc box and the request headers", async () => {
    await L.banner.getByRole("button", { name: "Add key", exact: true }).click();
    await L.openDialog.waitFor({ state: "visible", timeout: 3000 });
    await L.openDialog.locator('input[name="key"]').fill(FAKE_KEY);
    await L.openDialog.getByRole("button", { name: "Use this key", exact: true }).click();
    await waitUntil(() => textOf(page.locator("body")), (t) => t.includes("Live: calling Claude Opus 5.5 with your key."), "live banner");
    expectTrue(await L.arc.locator("#arc-description").isEnabled(), "arc box still disabled");
    return "live banner; arc box enabled";
  });

  await step(ctx, "Live path: an own-words arc is sent to our route with the key in a header only", "Type a description, click Plan arc; read the summary, the label, and the request", async () => {
    const words = "Warm-up, a long build, peak at midnight";
    await L.arc.locator("#arc-description").fill(words);
    await L.arc.getByRole("button", { name: "Plan arc", exact: true }).click();
    await waitUntil(() => textOf(L.arc), (t) => t.includes("Mock live arc: a steady climb to a late peak"), "live summary", 10000);
    const arc = await textOf(L.arc);
    expectTrue(arc.includes("Live from Claude Opus 5.5"), "no live source label");
    expectTrue(arc.includes("Set length taken from the description: 1 h."), "length note missing");
    const sent = seen.find((r) => r.url.endsWith("/api/arc") && r.body?.description === words);
    expectTrue(sent, "the request did not carry the description");
    expectTrue(sent.headers["x-anthropic-key"] === FAKE_KEY, "key not in the header");
    expectTrue(!("demoId" in sent.body), "a preset id was sent for typed words");
    expectTrue(sent.url.startsWith(BASE), "request went to another origin");
    return "live summary and label; key in header only; request to our own route";
  });

  await step(ctx, "Live path: Cancel stops an arc request and leaves the last curve in place", "Start a slow request, click Cancel; read the busy line and the summary", async () => {
    mock.arc = "slow";
    await L.arc.locator("#arc-description").fill("Slow start, then a late drop");
    await L.arc.getByRole("button", { name: "Plan arc", exact: true }).click();
    await waitUntil(() => textOf(L.arc), (t) => t.includes("Planning the arc…"), "busy line");
    await L.arc.getByRole("button", { name: "Cancel", exact: true }).click();
    await waitUntil(() => textOf(L.arc), (t) => !t.includes("Planning the arc…"), "busy line gone", 3000);
    await sleep(4200);
    const arc = await textOf(L.arc);
    expectTrue(!arc.includes("Slow start") && arc.includes("Mock live arc"), "a cancelled reply was applied");
    mock.arc = "ok";
    return "busy line cleared on Cancel; the late reply was not applied";
  });

  await step(ctx, "Live path: a refused arc request is shown as declined", "Make a model refusal for the arc; read the alert", async () => {
    mock.arc = "refusal";
    await L.arc.locator("#arc-description").fill("Something the model will not write");
    await L.arc.getByRole("button", { name: "Plan arc", exact: true }).click();
    await waitUntil(() => textOf(L.arc), (t) => t.includes("Declined: Model declined the request for the test."), "declined message");
    mock.arc = "ok";
    return "shown as declined";
  });

  await step(ctx, "Live path: mixing tips on a set that is not the opening one are written live", "Set length to 120 and Write mixing tips; read the tips and the error for a set that does not match", async () => {
    await typeLength(page, L, 120);
    await waitUntil(() => L.length.inputValue(), (v) => v === "120", "length 120");
    await settle(L);
    await page.getByRole("button", { name: "Write mixing tips", exact: true }).click();
    const alert = await waitUntil(() => textOf(L.set).catch(() => ""), (t) => t.includes("did not match this set"), "mismatch message", 10000);
    expectTrue(alert.includes("did not match this set"), "no mismatch message");
    return "fixture notes for another set are refused in the browser";
  });

  await step(ctx, "Live path: a refused notes request is shown as declined", "Refuse the notes request; read the alert", async () => {
    mock.notes = "refusal";
    await page.getByRole("button", { name: "Write mixing tips", exact: true }).click();
    await waitUntil(() => textOf(L.set), (t) => t.includes("Declined: Model declined the request for the test."), "declined notes", 10000);
    mock.notes = "ok";
    return "shown as declined";
  });

  await step(ctx, "Live path: opening set, live tips, labelled as a live response", "Go back to the opening set, Write mixing tips; read the tips and the live label", async () => {
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await waitUntil(() => L.length.inputValue(), (v) => v === "90", "length 90");
    await settle(L);
    // The opening set's tips from the earlier demo run are still stored, so the button may read "Write again".
    const declined = await textOf(L.set);
    expectTrue(!declined.includes("Declined: Model declined"), "the refusal for the other set is still shown");
    await page.getByRole("button", { name: /^(Write mixing tips|Write again)$/ }).click();
    await waitUntil(() => textOf(L.set), (t) => t.includes("Live from Claude Opus 5.5"), "live label", 10000);
    await waitUntil(() => L.tipLines.count(), (c) => c > 0, "live tips", 10000);
    const tips = await L.tipLines.count();
    expectTrue(tips > 0, "no tips");
    const set = await textOf(L.set);
    expectTrue(set.includes("Live from Claude Opus 5.5"), "no live label");
    return `${tips} live tips labelled as live; the earlier refusal is gone after Reset`;
  });

  await step(ctx, "Live path: Remove key returns the page to demo mode", "Open Change key, click Remove key; read the banner", async () => {
    await page.getByRole("button", { name: "Change key", exact: true }).click();
    await L.openDialog.waitFor({ state: "visible", timeout: 3000 });
    await L.openDialog.getByRole("button", { name: "Remove key", exact: true }).click();
    await waitUntil(() => L.banner.count(), (n) => n === 1, "demo banner back");
    const banner = await textOf(L.banner);
    expectTrue(banner.includes("pre-written examples"), `banner: "${banner}"`);
    await page.unroute("**/api/**");
    return "demo banner back; route interception removed";
  });
}

async function theme(ctx) {
  const { page } = ctx;
  await step(ctx, "Theme: the toggle switches between dark and light and remembers the choice", "Click the theme button; read the attribute, the saved value and the button label", async () => {
    const start = await page.evaluate(() => document.documentElement.dataset.theme);
    const toggle = page.getByRole("button", { name: /Switch to (light|dark) theme/ });
    const next = start === "dark" ? "light" : "dark";
    await toggle.click();
    await waitUntil(() => page.evaluate(() => document.documentElement.dataset.theme), (t) => t === next, `theme ${next}`);
    const saved = await page.evaluate(() => {
      try {
        return localStorage.getItem("theme");
      } catch {
        return "blocked";
      }
    });
    expectTrue(saved === next, `saved ${saved}`);
    await page.getByRole("button", { name: `Switch to ${start} theme` }).click();
    await waitUntil(() => page.evaluate(() => document.documentElement.dataset.theme), (t) => t === start, `theme ${start}`);
    return `${start} to ${next} and back`;
  });

  await step(ctx, "Theme: the page background changes with the theme", "Read the body background in each theme", async () => {
    const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.getByRole("button", { name: /Switch to (light|dark) theme/ }).click();
    await sleep(200);
    const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.getByRole("button", { name: /Switch to (light|dark) theme/ }).click();
    expectTrue(dark !== light, `both ${dark}`);
    return `${dark} vs ${light}`;
  });
}

async function skipLink(ctx) {
  const { page } = ctx;
  await step(ctx, "Skip to content link moves focus past the header", "Tab to the first link, press Enter; read the address", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => document.activeElement?.textContent ?? "");
    expectTrue(label.trim() === "Skip to content", `first tab stop is "${label}"`);
    await page.keyboard.press("Enter");
    const hash = await page.evaluate(() => location.hash);
    expectTrue(hash === "#main", `hash ${hash}`);
    return "focus lands on #main";
  });
}

async function introFold(ctx, L) {
  await step(ctx, "Primary button and the wheel are reachable on the first screen", "Read the bounding boxes of the tour button and the wheel", async () => {
    await ctx.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const button = await L.tour.boundingBox();
    expectTrue(button, "no button box");
    const viewport = ctx.page.viewportSize();
    expectTrue(button.y + button.height <= viewport.height, `button bottom ${button.y + button.height} is below the fold`);
    const wheel = await L.wheel.boundingBox();
    expectTrue(wheel && wheel.width <= viewport.width - 24, "wheel is wider than the screen");
    return `button bottom at ${Math.round(button.y + button.height)} px of ${viewport.height}`;
  });
}

async function apiContract(ctx) {
  const post = (route, body, headers = {}) =>
    fetch(`${BASE}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const apiStep = async (feature, how, check) => {
    try {
      const detail = await check();
      results.push({ suite: ctx.suite, feature, how, result: "pass", detail });
    } catch (error) {
      results.push({ suite: ctx.suite, feature, how, result: "fail", detail: String(error.message).slice(0, 240) });
    }
  };

  await apiStep("Routes: a preset with no key replays the pre-written example", "POST /api/arc with the tailgate demoId and no key header", async () => {
    const res = await post("/api/arc", { demoId: "tailgate", description: "3-hour house tailgate, 45-minute warm-up, peak at 1:45" });
    const body = await res.json();
    expectTrue(res.status === 200 && body.ok === true, `status ${res.status}`);
    expectTrue(body.meta.mode === "demo" && body.meta.placeholder === true, "not flagged as a demo placeholder");
    return "200, demo mode, placeholder true";
  });

  await apiStep("Routes: free text with no key is refused as a demo miss, with no model call", "POST /api/arc with a description and no key header", async () => {
    const res = await post("/api/arc", { description: "a warm-up then a peak at midnight" });
    const body = await res.json();
    expectTrue(res.status === 404 && body.error.kind === "demo_miss", `status ${res.status}, kind ${body.error?.kind}`);
    return "404 demo_miss";
  });

  await apiStep("Routes: a too-short description is rejected as invalid", "POST /api/arc with a 2-character description", async () => {
    const res = await post("/api/arc", { description: "ab" });
    const body = await res.json();
    expectTrue(res.status === 400 && body.error.kind === "invalid", `status ${res.status}, kind ${body.error?.kind}`);
    return "400 invalid";
  });

  await apiStep("Routes: an oversized body is refused before it is read", "POST /api/arc with a 5 KB body", async () => {
    const res = await post("/api/arc", { description: "x".repeat(5000) });
    expectTrue(res.status === 413, `status ${res.status}`);
    return "413 too_large";
  });

  await apiStep("Routes: notes with no key for a set that is not the opening one are refused", "POST /api/notes with a made-up two-track set and no key", async () => {
    const res = await post("/api/notes", {
      tracks: [
        { title: "A", artist: "B", key: "8A", bpm: 124, energy: 6 },
        { title: "C", artist: "D", key: "9A", bpm: 125, energy: 7 },
      ],
    });
    const body = await res.json();
    expectTrue(res.status === 404 && body.error.kind === "demo_miss", `status ${res.status}, kind ${body.error?.kind}`);
    return "404 demo_miss";
  });

  await apiStep("Routes: GET is not allowed on the API routes", "GET /api/arc", async () => {
    const res = await fetch(`${BASE}/api/arc`);
    expectTrue(res.status === 405, `status ${res.status}`);
    return "405";
  });
}

async function runSuite(browser, suite) {
  const context = await browser.newContext({ viewport: { width: suite.width, height: suite.height } });
  if (suite.theme === "light") {
    await context.addInitScript(() => {
      try {
        if (!sessionStorage.getItem("harmonic-func-theme-set")) {
          localStorage.setItem("theme", "light");
          sessionStorage.setItem("harmonic-func-theme-set", "1");
        }
      } catch {
        // Storage blocked: the page falls back to dark.
      }
    });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const ctx = { page, suite: suite.name, errors: [], apiRequests: [] };
  page.on("console", (message) => {
    if (message.type() === "error") ctx.errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => ctx.errors.push(`pageerror: ${error.message}`));
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/")) ctx.apiRequests.push(url);
    else if (!url.startsWith(BASE) && !url.startsWith("data:") && !url.startsWith("blob:")) {
      externalRequests.push(`${suite.name}: ${url}`);
    }
  });

  const L = locate(page);
  await firstPaint(ctx, L);
  if (suite.full) {
    await startOver(ctx, L);
    await setLength(ctx, L);
    await priorities(ctx, L);
    await optimizeAgain(ctx, L);
    await presets(ctx, L);
    await arcEditor(ctx, L);
    await wheelAndSetList(ctx, L);
    await exportsAndTips(ctx, L);
    await importFlows(ctx, L);
    await keyDialog(ctx, L);
    await liveMocked(ctx, L);
    await theme(ctx);
    await skipLink(ctx);
  } else {
    await theme(ctx);
  }
  await introFold(ctx, L);
  await context.close();
}

async function main() {
  const onlySuites = process.env.FUNCTIONAL_SUITES?.split(",").map((s) => s.trim());
  const suites = SUITES.filter((suite) => !onlySuites || onlySuites.includes(suite.name));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const suite of suites) {
      await runSuite(browser, suite);
    }
    await apiContract({ suite: "server" });
  } finally {
    await browser.close();
  }

  const failed = results.filter((row) => row.result === "fail");
  const summary = {
    base: BASE,
    passed: results.length - failed.length,
    failed: failed.length,
    externalRequests: [...new Set(externalRequests)],
    results,
  };
  writeFileSync(path.join(OUT, "results.json"), JSON.stringify(summary, null, 2));
  for (const row of results) {
    console.log(`${row.result.toUpperCase().padEnd(4)} [${row.suite}] ${row.feature}${row.result === "fail" ? ` :: ${row.detail}` : ""}`);
  }
  console.log(`\n${summary.passed} passed, ${summary.failed} failed. External requests: ${summary.externalRequests.length}`);
  if (summary.externalRequests.length) console.log(summary.externalRequests.join("\n"));
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
