/**
 * Every fixture must be a valid output of the real pipeline: it goes through
 * the same validators the live path uses. Flags are compared with each
 * fixture's own `placeholder` value, so these tests keep passing after
 * `pnpm record` replaces the hand-written samples with real runs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import arcStore from "@/fixtures/arc.json";
import notesStore from "@/fixtures/notes.json";
import { validateArc, type ArcPlan } from "@/lib/ai/arc";
import { ArcRequest } from "@/lib/ai/arc-live";
import { buildMixes, notesFit, type NotesResult } from "@/lib/ai/notes";
import { NotesRequest } from "@/lib/ai/notes-live";
import { SAMPLE_TRACKS } from "@/lib/crate/sample";
import { ARC_PRESETS, DEFAULT_SET_DEMO_ID, defaultRun, noteTracks } from "@/lib/defaults";
import type { Fixture, FixtureStore } from "@/lib/demo";

const arcs = arcStore as FixtureStore<ArcPlan>;
const notes = notesStore as FixtureStore<NotesResult>;
const everyFixture: [string, Fixture][] = [
  ...Object.entries(arcs).map(([key, fixture]): [string, Fixture] => [`arc/${key}`, fixture]),
  ...Object.entries(notes).map(([key, fixture]): [string, Fixture] => [`notes/${key}`, fixture]),
];

/** The request bodies `pnpm record` replays, built from the same code the app uses. */
function expectedPresets() {
  return [
    ...ARC_PRESETS.map((preset) => ({
      route: "/api/arc",
      body: { demoId: preset.demoId, description: preset.description },
    })),
    {
      route: "/api/notes",
      body: {
        demoId: DEFAULT_SET_DEMO_ID,
        tracks: noteTracks(SAMPLE_TRACKS, defaultRun().order),
      },
    },
  ];
}

describe("fixture bookkeeping", () => {
  it.each(everyFixture)("%s is flagged honestly", (_name, fixture) => {
    // A placeholder has no recording date and no cost; a recorded run has both a date and tokens.
    expect(fixture.recordedAt === null).toBe(fixture.placeholder);
    if (fixture.placeholder) {
      expect(fixture.costUsd).toBe(0);
      expect(fixture.usage.output_tokens).toBe(0);
    } else {
      expect(fixture.usage.output_tokens).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(fixture.recordedAt ?? ""))).toBe(false);
    }
    expect(fixture.model).toMatch(/^claude-/);
  });
});

describe("arc fixtures", () => {
  it("has one fixture per preset button, and no strays", () => {
    expect(Object.keys(arcs).sort()).toEqual(ARC_PRESETS.map((preset) => preset.demoId).sort());
  });

  it.each(Object.entries(arcs))(
    "%s is exactly what the live validator would return",
    (_key, fixture) => {
      const plan = validateArc(fixture.data);
      expect(plan).not.toBeNull();
      expect(plan).toEqual(fixture.data);
    },
  );

  // The checks below describe the hand-written samples. A recorded run is the model's own
  // judgement, so once a fixture is real only the pipeline checks above apply to it.
  const samples = Object.entries(arcs).filter(([, fixture]) => fixture.placeholder);

  it("hand-written samples follow the brief the prompt gives the model", () => {
    for (const [, fixture] of samples) {
      expect(fixture.data.points.length).toBeGreaterThanOrEqual(12);
      expect(fixture.data.points.length).toBeLessThanOrEqual(24);
      expect(fixture.data.summary.length).toBeLessThanOrEqual(140);
      expect(fixture.data.durationMinutes).not.toBeNull();
    }
  });

  it("hand-written samples match the times each preset description asks for", () => {
    const sample = Object.fromEntries(samples);
    const peakOf = (plan: ArcPlan) =>
      plan.points.reduce((best, point) => (point.e > best.e ? point : best));
    if (sample.tailgate) {
      // "peak at 1:45" of three hours.
      expect(sample.tailgate.data.durationMinutes).toBe(180);
      expect(peakOf(sample.tailgate.data).t).toBeCloseTo(105 / 180, 2);
    }
    if (sample["sunset-rooftop"]) {
      // "peak in the last 20 minutes" of ninety.
      expect(sample["sunset-rooftop"].data.durationMinutes).toBe(90);
      expect(peakOf(sample["sunset-rooftop"].data).t).toBeGreaterThan(70 / 90);
    }
    if (sample["peak-time"]) {
      // "a breather at the one-hour mark" of two hours: a dip between two peaks.
      const club = sample["peak-time"].data;
      expect(club.durationMinutes).toBe(120);
      const at = (t: number) =>
        club.points.reduce((near, point) =>
          Math.abs(point.t - t) < Math.abs(near.t - t) ? point : near,
        );
      expect(at(0.5).e).toBeLessThan(at(0.28).e - 0.2);
      expect(at(0.5).e).toBeLessThan(at(0.88).e - 0.2);
    }
  });
});

describe("notes fixture", () => {
  it("fits the default optimized set and passes the fact check for every mix", () => {
    const fixture = notes[DEFAULT_SET_DEMO_ID];
    expect(fixture).toBeDefined();
    const mixes = buildMixes(noteTracks(SAMPLE_TRACKS, defaultRun().order));
    expect(fixture.data.notes).toHaveLength(mixes.length);
    expect(notesFit(mixes, fixture.data)).toBe(true);
    if (fixture.placeholder) {
      // The hand-written sample also keeps to the length the prompt asks the model for.
      for (const note of fixture.data.notes) {
        expect(note.note.split(/\s+/).length).toBeLessThanOrEqual(22);
      }
    }
  });
});

describe("fixtures/presets.json", () => {
  const path = "fixtures/presets.json";
  const expected = expectedPresets();
  // Regenerate with: UPDATE_PRESETS=1 pnpm vitest run tests/fixtures.test.ts
  if (process.env.UPDATE_PRESETS === "1") {
    writeFileSync(path, `${JSON.stringify(expected, null, 2)}\n`);
  }
  const presets = JSON.parse(readFileSync(path, "utf8")) as { route: string; body: unknown }[];

  it("lists every preset request, built from the app's own code", () => {
    expect(presets).toEqual(expected);
  });

  it("has a fixture behind every preset and a preset behind every fixture", () => {
    const keys = presets.map((preset) => {
      const body = preset.body as { demoId: string };
      return `${preset.route === "/api/arc" ? "arc" : "notes"}/${body.demoId}`;
    });
    expect(keys.sort()).toEqual(everyFixture.map(([name]) => name).sort());
  });

  it("holds request bodies the routes accept", () => {
    for (const preset of presets) {
      const schema = preset.route === "/api/arc" ? ArcRequest : NotesRequest;
      expect(schema.safeParse(preset.body).success).toBe(true);
    }
  });
});
