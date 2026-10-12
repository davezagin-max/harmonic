import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAMPLE_TRACKS } from "@/lib/crate/sample";
import { planSet } from "@/lib/crate/set";
import { playSeconds, type Track } from "@/lib/crate/types";
import { parseKey } from "@/lib/music/camelot";
import { DEFAULT_ARC } from "@/lib/music/energy";
import {
  DEFAULT_SEED,
  DEFAULT_WEIGHTS,
  optimize,
  scoreOrder,
  type OptimizeInput,
} from "@/lib/optimizer/optimize";
import { mulberry32, shuffle } from "@/lib/optimizer/rng";

const base: OptimizeInput = {
  tracks: SAMPLE_TRACKS,
  arc: DEFAULT_ARC,
  targetSec: 90 * 60,
  weights: DEFAULT_WEIGHTS,
  seed: DEFAULT_SEED,
};

function track(id: number, key: string, bpm: number, energy: number, durationSec = 360): Track {
  return {
    id: `x${id}`,
    title: `Track ${id}`,
    artist: "Test",
    bpm,
    key: parseKey(key)!,
    energy,
    energyDerived: false,
    genre: "House",
    durationSec,
    durationAssumed: false,
    path: null,
  };
}

describe("seeded random numbers", () => {
  it("gives the same sequence for the same seed and a different one for another", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("shuffles into a permutation", () => {
    const items = Int32Array.from({ length: 50 }, (_, i) => i);
    shuffle(items, mulberry32(1));
    expect([...items].sort((x, y) => x - y)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect([...items]).not.toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
});

describe("optimize on the sample crate", () => {
  const result = optimize(base);
  const set = planSet(SAMPLE_TRACKS, result.order, DEFAULT_ARC, base.targetSec);

  it("beats the random-order baseline by a clear margin", () => {
    expect(result.baseline.shuffles).toBe(200);
    // Less than half the average random cost, and better than the luckiest of 200 shuffles.
    expect(result.cost.total).toBeLessThan(result.baseline.mean * 0.5);
    expect(result.cost.total).toBeLessThan(result.baseline.min);
    expect(result.improvementPct).toBeGreaterThan(50);
  });

  it("produces far more clean mixes than a random order", () => {
    expect(result.cleanShare).toBeGreaterThan(0.9);
    expect(result.baseline.cleanShare).toBeLessThan(0.4);
    expect(set.stats.cleanMixes / set.stats.mixes).toBeCloseTo(result.cleanShare, 9);
    expect(set.stats.tempoOutOfRange).toBe(0);
  });

  it("fills the target length to within half a track", () => {
    const longest = Math.max(...SAMPLE_TRACKS.map(playSeconds));
    expect(Math.abs(result.totalSec - base.targetSec)).toBeLessThanOrEqual(longest / 2);
    expect(set.totalSec).toBeCloseTo(result.totalSec, 6);
  });

  it("plays each track at most once", () => {
    expect(new Set(result.order).size).toBe(result.order.length);
    for (const index of result.order) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(SAMPLE_TRACKS.length);
    }
  });

  it("follows the energy arc: within about a level on average", () => {
    expect(set.stats.avgEnergyMiss).toBeLessThan(1);
  });

  it("is reproducible: the same seed gives the same set and the same numbers", () => {
    expect(optimize(base)).toEqual(result);
  });

  it("gives a different search for a different seed, and still beats the baseline", () => {
    const other = optimize({ ...base, seed: 99 });
    expect(other.trace.current).not.toEqual(result.trace.current);
    expect(other.cost.total).toBeLessThan(other.baseline.mean * 0.5);
  });

  it("lands in the same neighbourhood from any starting point", () => {
    // Annealing is a heuristic: seeds differ a little, but none should be far from the others.
    const costs = [1, 2, 3, 4, 5, 6, 8, 9].map((seed) => optimize({ ...base, seed }).cost.total);
    for (const cost of costs) {
      expect(cost).toBeLessThan(result.baseline.mean * 0.2);
      expect(cost).toBeLessThan(result.baseline.min * 0.35);
    }
    expect(Math.max(...costs) - Math.min(...costs)).toBeLessThan(result.baseline.mean * 0.06);
  });

  it("reports a cost breakdown that adds up and matches scoreOrder", () => {
    const { cost } = result;
    expect(cost.key + cost.tempo + cost.energy + cost.fill).toBeCloseTo(cost.total, 9);
    expect(scoreOrder(base, result.order).total).toBeCloseTo(cost.total, 9);
    // The search's own running best agrees with the readable breakdown.
    expect(result.trace.best.at(-1)).toBeCloseTo(cost.total, 6);
  });

  it("records a trace whose best cost never goes up", () => {
    const { best } = result.trace;
    expect(best.length).toBeGreaterThan(50);
    for (let i = 1; i < best.length; i++) expect(best[i]).toBeLessThanOrEqual(best[i - 1] + 1e-12);
  });

  it("responds to the weights: ignoring key leaves more clashes than ignoring energy", () => {
    const noKey = optimize({ ...base, weights: { key: 0, tempo: 1, energy: 1 } });
    const noEnergy = optimize({ ...base, weights: { key: 1, tempo: 1, energy: 0 } });
    const clashes = (order: number[]) =>
      planSet(SAMPLE_TRACKS, order, DEFAULT_ARC, base.targetSec).stats.keyClashes;
    expect(clashes(noEnergy.order)).toBeLessThan(clashes(noKey.order));
    const miss = (order: number[]) =>
      planSet(SAMPLE_TRACKS, order, DEFAULT_ARC, base.targetSec).stats.avgEnergyMiss;
    expect(miss(noKey.order)).toBeLessThan(miss(noEnergy.order));
  });

  it("follows a different arc when given one", () => {
    const falling = [
      { t: 0, e: 0.9 },
      { t: 1, e: 0.25 },
    ];
    const down = optimize({ ...base, arc: falling });
    const energies = down.order.map((index) => SAMPLE_TRACKS[index].energy);
    const half = Math.floor(energies.length / 2);
    const mean = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(energies.slice(0, half))).toBeGreaterThan(mean(energies.slice(half)) + 1.5);
  });
});

describe("reproducibility across JavaScript engines", () => {
  it("keeps the search to arithmetic every engine rounds the same way", () => {
    // Math.exp, Math.pow and friends are allowed to differ in the last bit between engines,
    // which would be enough to send the same seed down a different path in another browser.
    const files = [
      "lib/optimizer/optimize.ts",
      "lib/optimizer/rng.ts",
      "lib/music/bpm.ts",
      "lib/music/camelot.ts",
      "lib/music/energy.ts",
      "lib/music/transition.ts",
      "lib/crate/types.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(source, file).not.toMatch(
        /Math\.(exp|pow|log|log2|log10|sqrt|sin|cos|tan|hypot|random)\b|\*\*/,
      );
    }
  });
});

describe("optimize on small and awkward crates", () => {
  it("finds the obvious chain in a tiny crate", () => {
    const crate = [
      track(1, "8A", 120, 3),
      track(2, "2B", 128, 9),
      track(3, "9A", 122, 5),
      track(4, "10A", 124, 7),
      track(5, "5B", 100, 2),
      track(6, "11A", 126, 9),
    ];
    const rising = [
      { t: 0, e: 0.2 },
      { t: 1, e: 0.9 },
    ];
    const result = optimize({
      tracks: crate,
      arc: rising,
      targetSec: 4 * 300,
      weights: DEFAULT_WEIGHTS,
      seed: 3,
    });
    expect(result.order.map((index) => crate[index].id)).toEqual(["x1", "x3", "x4", "x6"]);
    expect(result.cleanShare).toBe(1);
  });

  it("uses the whole crate when it is shorter than the target", () => {
    const crate = [track(1, "8A", 120, 4), track(2, "9A", 121, 5), track(3, "10A", 122, 6)];
    const result = optimize({ ...base, tracks: crate, targetSec: 3600 });
    expect([...result.order].sort()).toEqual([0, 1, 2]);
  });

  it("handles an empty crate and a single track", () => {
    const empty = optimize({ ...base, tracks: [] });
    expect(empty.order).toEqual([]);
    expect(empty.totalSec).toBe(0);
    const one = optimize({ ...base, tracks: [track(1, "8A", 120, 4)], targetSec: 600 });
    expect(one.order).toEqual([0]);
    expect(one.cleanShare).toBe(1);
  });

  it("recognises a half-time track as mixable", () => {
    const crate = [track(1, "8A", 174, 6), track(2, "8A", 87, 6), track(3, "3B", 140, 6)];
    const flat = [
      { t: 0, e: 0.55 },
      { t: 1, e: 0.55 },
    ];
    const result = optimize({ ...base, tracks: crate, arc: flat, targetSec: 2 * 300 });
    expect([...result.order].sort()).toEqual([0, 1]);
  });
});
