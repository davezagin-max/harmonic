/**
 * Smoke test: the main path a visitor takes with no key.
 * Open the page (default set), pick an arc preset, re-plan, ask for notes.
 * Runs the real route handlers; no network, no model.
 */
import { describe, expect, it } from "vitest";
import { POST as arcRoute } from "@/app/api/arc/route";
import { POST as notesRoute } from "@/app/api/notes/route";
import arcStore from "@/fixtures/arc.json";
import notesStore from "@/fixtures/notes.json";
import { validateArc, type ArcPlan } from "@/lib/ai/arc";
import { buildMixes, notesFit, type NotesResult } from "@/lib/ai/notes";
import type { ApiResponse } from "@/lib/api";
import { setListCsv, setListM3u } from "@/lib/crate/export";
import { SAMPLE_TRACKS } from "@/lib/crate/sample";
import { planSet } from "@/lib/crate/set";
import { playSeconds } from "@/lib/crate/types";
import {
  ARC_PRESETS,
  DEFAULT_SET_DEMO_ID,
  DEFAULT_TARGET_MIN,
  defaultInput,
  defaultRun,
  noteTracks,
} from "@/lib/defaults";
import { optimize } from "@/lib/optimizer/optimize";
import { presetHint, sourceLabel } from "@/lib/ui/labels";

let caller = 0;
function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  caller += 1;
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.0.0.${caller}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("main path in demo mode", () => {
  it("opens on an optimized default set", () => {
    const run = defaultRun();
    const input = defaultInput();
    const set = planSet(SAMPLE_TRACKS, run.order, input.arc, input.targetSec);
    expect(set.entries.length).toBeGreaterThan(10);
    expect(run.improvementPct).toBeGreaterThan(60);
    expect(set.stats.cleanMixes / set.stats.mixes).toBeGreaterThan(0.9);
    expect(Math.abs(set.totalSec - input.targetSec)).toBeLessThan(5 * 60);
  });

  it.each(ARC_PRESETS)("replays the $demoId arc and plans a set to it", async (preset) => {
    const response = await arcRoute(
      post("/api/arc", { demoId: preset.demoId, description: preset.description }),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as ApiResponse<ArcPlan>;
    if (!json.ok) throw new Error(json.error.message);
    expect(json.meta.mode).toBe("demo");
    // The honesty flag reaches the browser exactly as stored.
    const stored = (arcStore as Record<string, { placeholder: boolean }>)[preset.demoId];
    expect(json.meta.placeholder).toBe(stored.placeholder);

    const arc = validateArc(json.data);
    expect(arc).not.toBeNull();
    if (!arc) throw new Error("preset arc did not validate");
    // The app keeps the current length when the description gives none.
    const targetSec = (arc.durationMinutes ?? DEFAULT_TARGET_MIN) * 60;
    const result = optimize({ ...defaultInput(), arc: arc.points, targetSec });
    // Whatever the curve, the search must beat the luckiest of 200 random orders.
    expect(result.cost.total).toBeLessThan(result.baseline.min);
    expect(result.improvementPct).toBeGreaterThan(25);
    const longest = Math.max(...SAMPLE_TRACKS.map(playSeconds));
    expect(Math.abs(result.totalSec - targetSec)).toBeLessThanOrEqual(longest / 2);

    const set = planSet(SAMPLE_TRACKS, result.order, arc.points, targetSec);
    expect(set.entries).toHaveLength(result.order.length);
    // Exports of the planned set are well formed.
    expect(setListCsv(set).trimEnd().split("\r\n")).toHaveLength(set.entries.length + 1);
    expect(setListM3u(set, "Set").startsWith("#EXTM3U\n")).toBe(true);
  });

  it("replays transition notes that fit the default set", async () => {
    const tracks = noteTracks(SAMPLE_TRACKS, defaultRun().order);
    const response = await notesRoute(post("/api/notes", { demoId: DEFAULT_SET_DEMO_ID, tracks }));
    expect(response.status).toBe(200);
    const json = (await response.json()) as ApiResponse<NotesResult>;
    if (!json.ok) throw new Error(json.error.message);
    expect(json.meta.mode).toBe("demo");
    const stored = (notesStore as Record<string, { placeholder: boolean }>)[DEFAULT_SET_DEMO_ID];
    expect(json.meta.placeholder).toBe(stored.placeholder);
    if (json.meta.placeholder) expect(json.meta.costUsd).toBe(0);
    expect(notesFit(buildMixes(tracks), json.data)).toBe(true);
  });

  it("explains a demo miss for free text and for a set with no recorded notes", async () => {
    const arc = await arcRoute(post("/api/arc", { description: "one hour of deep house" }));
    expect(arc.status).toBe(404);
    const arcJson = (await arc.json()) as ApiResponse<ArcPlan>;
    expect(!arcJson.ok && arcJson.error.kind).toBe("demo_miss");
    expect(!arcJson.ok && arcJson.error.message).toContain("add your Anthropic key");

    const tracks = noteTracks(SAMPLE_TRACKS, [0, 1, 2]);
    const notes = await notesRoute(post("/api/notes", { tracks }));
    expect(notes.status).toBe(404);
  });

  it("rejects malformed requests before doing anything else", async () => {
    expect((await arcRoute(post("/api/arc", { description: "" }))).status).toBe(400);
    expect((await arcRoute(post("/api/arc", { description: "x".repeat(401) }))).status).toBe(400);
    expect((await notesRoute(post("/api/notes", { tracks: [] }))).status).toBe(400);
    const badKey = [
      { title: "A", artist: "", key: "H#", bpm: 120, energy: 5 },
      { title: "B", artist: "", key: "8A", bpm: 120, energy: 5 },
    ];
    expect((await notesRoute(post("/api/notes", { tracks: badKey }))).status).toBe(400);
    const oversized = await arcRoute(post("/api/arc", { description: "x", pad: "y".repeat(5000) }));
    expect(oversized.status).toBe(413);
  });

  it("rejects a malformed key without calling anything", async () => {
    const response = await arcRoute(
      post("/api/arc", { description: "two hours of house" }, { "x-anthropic-key": "not-a-key" }),
    );
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("not-a-key");
  });
});

describe("source labels", () => {
  it("never calls hand-written output a model run", () => {
    expect(sourceLabel({ mode: "demo", placeholder: true })).toBe(
      "Sample output, hand-written (not a model run)",
    );
    expect(sourceLabel({ mode: "demo", placeholder: false })).toBe("Recorded Claude Opus 5.5 run");
    expect(sourceLabel({ mode: "live", placeholder: false })).toBe("Live from Claude Opus 5.5");
    expect(presetHint(false, true)).toContain("hand-written sample output");
    expect(presetHint(false, true)).not.toContain("recorded");
    expect(presetHint(false, false)).toContain("recorded Claude Opus 5.5 run");
    expect(presetHint(true, true)).toBe("Live with your key.");
  });
});
