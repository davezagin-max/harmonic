/**
 * The state the app opens in: the sample crate, a 90-minute set, the default
 * arc, and a fixed seed. The server runs this once at build time so the first
 * paint already shows an optimized set, and the demo transition notes are
 * written for exactly this set.
 */
import { SAMPLE_TRACKS } from "./crate/sample";
import type { NoteTrack } from "./ai/notes";
import type { Track } from "./crate/types";
import { keyCode } from "./music/camelot";
import { DEFAULT_ARC } from "./music/energy";
import {
  DEFAULT_SEED,
  DEFAULT_WEIGHTS,
  optimize,
  type OptimizeInput,
  type OptimizeResult,
} from "./optimizer/optimize";

export const DEFAULT_TARGET_MIN = 90;
export const MIN_TARGET_MIN = 20;
export const MAX_TARGET_MIN = 360;

/** `demoId` of the transition-notes fixture written for the default set. */
export const DEFAULT_SET_DEMO_ID = "default-set";

export function defaultInput(): OptimizeInput {
  return {
    tracks: SAMPLE_TRACKS,
    arc: DEFAULT_ARC,
    targetSec: DEFAULT_TARGET_MIN * 60,
    weights: DEFAULT_WEIGHTS,
    seed: DEFAULT_SEED,
  };
}

let cached: OptimizeResult | null = null;

/** The optimized default set. Deterministic, so it is computed once per process. */
export function defaultRun(): OptimizeResult {
  cached ??= optimize(defaultInput());
  return cached;
}

/** The raw track data `/api/notes` takes: nothing but what the server needs to recompute the facts. */
export function noteTracks(tracks: readonly Track[], order: readonly number[]): NoteTrack[] {
  return order.map((index) => {
    const track = tracks[index];
    return {
      title: track.title,
      artist: track.artist,
      key: keyCode(track.key),
      bpm: track.bpm,
      energy: track.energy,
    };
  });
}

/** Preset set descriptions for "arc from words". Each `demoId` is a fixture key in `fixtures/arc.json`. */
export const ARC_PRESETS = [
  {
    demoId: "tailgate",
    label: "3-hour tailgate",
    description: "3-hour house tailgate, 45-minute warm-up, peak at 1:45",
  },
  {
    demoId: "sunset-rooftop",
    label: "Sunset rooftop",
    description:
      "90-minute sunset rooftop set: start mellow, one long slow build, peak in the last 20 minutes",
  },
  {
    demoId: "peak-time",
    label: "Peak-time club slot",
    description:
      "2-hour club peak-time slot: come in hot, a breather at the one-hour mark, second peak before close",
  },
] as const;
