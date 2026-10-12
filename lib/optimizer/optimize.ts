/**
 * Set optimizer: choose which tracks to play and in what order.
 *
 * The search state is one ordering of the whole crate. The set is the front of
 * that ordering: tracks are taken in order until the target length is filled.
 * That makes "which tracks" and "what order" a single search: swapping a track
 * near the front with one further back replaces it in the set.
 *
 * Cost of a set (lower is better):
 *   for each mix:    weight.key   x key cost   (0 same key ... 1 worst clash)
 *                  + weight.tempo x tempo cost (0-1 inside ±6%, 2-5 outside)
 *   for each track:  weight.energy x |track energy - target energy| / 3 levels
 *   once:            a small penalty for missing the target length
 *
 * Search: simulated annealing with swap, insert, and reverse moves, then a
 * greedy pass that keeps applying any single swap that still helps. The result
 * is compared with random orderings of the same crate, scored the same way.
 *
 * Pure and deterministic for a given seed. Runs in a Web Worker in the browser
 * and directly on the server for the first paint and in tests.
 */
import { playSeconds, type Track } from "../crate/types";
import { tempoMove } from "../music/bpm";
import { keyMove } from "../music/camelot";
import { energyAt, toLevel, type ArcPoint } from "../music/energy";
import { mulberry32, randomInt, shuffle, type Rng } from "./rng";

export interface Weights {
  key: number;
  tempo: number;
  energy: number;
}

export const DEFAULT_WEIGHTS: Weights = { key: 1, tempo: 1, energy: 1 };
export const DEFAULT_SEED = 7;
export const BASELINE_SHUFFLES = 200;
const BASELINE_SEED = 0x5eed;

/** A miss of this many energy levels costs as much as the worst key clash. */
const ENERGY_SCALE = 3;
const FILL_WEIGHT = 4;
const ARC_STEPS = 512;
const TRACE_POINTS = 96;
const START_TEMPERATURE = 1.2;
const END_TEMPERATURE = 0.004;

export interface OptimizeInput {
  tracks: readonly Track[];
  arc: readonly ArcPoint[];
  targetSec: number;
  weights: Weights;
  seed: number;
  /** Annealing steps. Defaults to a count that scales with the crate size. */
  iterations?: number;
  baselineShuffles?: number;
}

export interface CostBreakdown {
  total: number;
  key: number;
  tempo: number;
  energy: number;
  fill: number;
}

export interface Baseline {
  shuffles: number;
  mean: number;
  min: number;
  max: number;
  /** Average share of mixes with a compatible key and an in-range tempo, 0-1. */
  cleanShare: number;
}

export interface OptimizeResult {
  /** Indexes into `input.tracks`, in play order. */
  order: number[];
  totalSec: number;
  cost: CostBreakdown;
  /** Share of mixes with a compatible key and an in-range tempo, 0-1. */
  cleanShare: number;
  baseline: Baseline;
  /** How far below the random-order average the optimized cost is, in percent. */
  improvementPct: number;
  /** Cost over the course of the search, sampled at even intervals. */
  trace: { best: number[]; current: number[] };
  iterations: number;
  seed: number;
}

interface Problem {
  n: number;
  /** Weighted key + tempo cost of mixing track i into track j, at [i * n + j]. */
  pair: Float64Array;
  /** 1 when mixing i into j has a compatible key and an in-range tempo. */
  clean: Uint8Array;
  energy: Float64Array;
  play: Float64Array;
  /** Target energy level (1-10) at ARC_STEPS + 1 evenly spaced positions. */
  arcTable: Float64Array;
  targetSec: number;
  energyWeight: number;
}

interface Scratch {
  /** Number of tracks in the set for the ordering last evaluated. */
  k: number;
  totalSec: number;
}

export function defaultIterations(crateSize: number): number {
  return Math.min(400_000, 100_000 + 750 * crateSize);
}

function buildProblem(input: OptimizeInput): Problem {
  const { tracks, weights } = input;
  const n = tracks.length;
  const pair = new Float64Array(n * n);
  const clean = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const key = keyMove(tracks[i].key, tracks[j].key);
      const tempo = tempoMove(tracks[i].bpm, tracks[j].bpm);
      pair[i * n + j] = weights.key * key.cost + weights.tempo * tempo.cost;
      clean[i * n + j] = key.relation !== "clash" && tempo.inRange ? 1 : 0;
    }
  }
  const arcTable = new Float64Array(ARC_STEPS + 1);
  for (let step = 0; step <= ARC_STEPS; step++) {
    arcTable[step] = toLevel(energyAt(input.arc, step / ARC_STEPS));
  }
  return {
    n,
    pair,
    clean,
    energy: Float64Array.from(tracks, (track) => track.energy),
    play: Float64Array.from(tracks, (track) => playSeconds(track)),
    arcTable,
    targetSec: Math.max(1, input.targetSec),
    energyWeight: weights.energy,
  };
}

/** Target level for a track whose middle falls at `elapsedSec` into the set. */
function targetLevel(p: Problem, elapsedSec: number): number {
  const position = Math.min(1, elapsedSec / p.targetSec);
  return p.arcTable[Math.round(position * ARC_STEPS)];
}

/**
 * Scores an ordering. Takes tracks from the front while each one brings the
 * running length closer to the target, so the set lands within half a track of
 * it. Writes the set size and length to `out`.
 */
function evaluate(p: Problem, perm: Int32Array, out: Scratch): number {
  const { n, pair, energy, play, targetSec, energyWeight } = p;
  let total = 0;
  let k = 0;
  let cost = 0;
  let previous = -1;
  while (k < n) {
    const id = perm[k];
    const length = play[id];
    if (total + length / 2 >= targetSec) break;
    cost +=
      (energyWeight * Math.abs(energy[id] - targetLevel(p, total + length / 2))) / ENERGY_SCALE;
    if (previous >= 0) cost += pair[previous * n + id];
    total += length;
    previous = id;
    k++;
  }
  cost += (FILL_WEIGHT * Math.abs(total - targetSec)) / targetSec;
  out.k = k;
  out.totalSec = total;
  return cost;
}

/** The same score as `evaluate`, split into its parts, for display. */
function breakdown(p: Problem, input: OptimizeInput, order: readonly number[]): CostBreakdown {
  const { tracks, weights } = input;
  let key = 0;
  let tempo = 0;
  let energy = 0;
  let total = 0;
  order.forEach((id, position) => {
    const length = p.play[id];
    energy +=
      (weights.energy * Math.abs(p.energy[id] - targetLevel(p, total + length / 2))) / ENERGY_SCALE;
    if (position > 0) {
      const before = tracks[order[position - 1]];
      key += weights.key * keyMove(before.key, tracks[id].key).cost;
      tempo += weights.tempo * tempoMove(before.bpm, tracks[id].bpm).cost;
    }
    total += length;
  });
  const fill = (FILL_WEIGHT * Math.abs(total - p.targetSec)) / p.targetSec;
  return { total: key + tempo + energy + fill, key, tempo, energy, fill };
}

function cleanShareOf(p: Problem, perm: Int32Array | readonly number[], k: number): number {
  if (k < 2) return 1;
  let cleanMixes = 0;
  for (let i = 1; i < k; i++) cleanMixes += p.clean[perm[i - 1] * p.n + perm[i]];
  return cleanMixes / (k - 1);
}

function measureBaseline(p: Problem, rng: Rng, shuffles: number): Baseline {
  const perm = Int32Array.from({ length: p.n }, (_, i) => i);
  const scratch: Scratch = { k: 0, totalSec: 0 };
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let cleanSum = 0;
  for (let s = 0; s < shuffles; s++) {
    shuffle(perm, rng);
    const cost = evaluate(p, perm, scratch);
    sum += cost;
    min = Math.min(min, cost);
    max = Math.max(max, cost);
    cleanSum += cleanShareOf(p, perm, scratch.k);
  }
  return { shuffles, mean: sum / shuffles, min, max, cleanShare: cleanSum / shuffles };
}

/** Moves the item at `from` so it ends up at index `to`, shifting the items between. */
function moveItem(items: Int32Array, from: number, to: number): void {
  if (from === to) return;
  const held = items[from];
  if (from < to) items.copyWithin(from, from + 1, to + 1);
  else items.copyWithin(to + 1, to, from);
  items[to] = held;
}

function reverseRange(items: Int32Array, start: number, end: number): void {
  for (let i = start, j = end; i < j; i++, j--) {
    const held = items[i];
    items[i] = items[j];
    items[j] = held;
  }
}

function swapItems(items: Int32Array, i: number, j: number): void {
  const held = items[i];
  items[i] = items[j];
  items[j] = held;
}

/**
 * Greedy finish: try swapping every set position with every crate position and
 * keep any swap that lowers the cost, until a full sweep finds none.
 */
function polish(p: Problem, perm: Int32Array, scratch: Scratch, startCost: number): number {
  let cost = startCost;
  for (let sweep = 0; sweep < 20; sweep++) {
    let improved = false;
    evaluate(p, perm, scratch);
    const k = scratch.k;
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < p.n; j++) {
        if (j === i || (j < k && j < i)) continue;
        swapItems(perm, i, j);
        const next = evaluate(p, perm, scratch);
        if (next < cost - 1e-9) {
          cost = next;
          improved = true;
        } else {
          swapItems(perm, i, j);
        }
      }
    }
    if (!improved) break;
  }
  return cost;
}

/**
 * Cooling schedule: hot at the start (bad moves are often accepted, so the
 * search roams), close to zero at the end (only improvements survive).
 * `progress` runs from 0 to 1.
 */
function temperatureAt(progress: number): number {
  const left = 1 - progress;
  return END_TEMPERATURE + (START_TEMPERATURE - END_TEMPERATURE) * left * left * left * left;
}

/**
 * Chance of accepting a move that makes the set worse by `x` temperatures.
 * This is e^-x, the usual annealing rule, written as 1 / (1 + x + x²/2 + x³/6 + x⁴/24).
 * Math.exp and Math.pow may round differently from one JavaScript engine to
 * the next; plain arithmetic may not, so a seed gives the same set everywhere:
 * on the build server, in CI, and in any browser.
 */
function acceptance(x: number): number {
  return 1 / (1 + x * (1 + (x / 2) * (1 + (x / 3) * (1 + x / 4))));
}

export function optimize(input: OptimizeInput): OptimizeResult {
  const p = buildProblem(input);
  const { n } = p;
  const shuffles = input.baselineShuffles ?? BASELINE_SHUFFLES;
  // The baseline has its own fixed generator: it describes the crate and the arc, so it must not
  // move when the visitor re-rolls the search seed or the search runs for longer.
  const baseline = measureBaseline(p, mulberry32(BASELINE_SEED), shuffles);

  const rng = mulberry32(input.seed);
  const scratch: Scratch = { k: 0, totalSec: 0 };
  const perm = Int32Array.from({ length: n }, (_, i) => i);
  shuffle(perm, rng);

  let current = evaluate(p, perm, scratch);
  let k = scratch.k;
  let best = current;
  const bestPerm = perm.slice();
  const iterations = n < 3 || k < 1 ? 0 : (input.iterations ?? defaultIterations(n));
  const trace = { best: [best], current: [current] };

  for (let step = 0; step < iterations; step++) {
    const temperature = temperatureAt(step / iterations);
    const roll = rng();
    const size = Math.max(1, k);
    // Every move touches the set (the first k positions); the other end may be anywhere in the crate.
    let a = randomInt(rng, size);
    let b: number;
    let kind: "swap" | "insert" | "reverse";
    if (roll < 0.4) {
      kind = "swap";
      b = randomInt(rng, n);
      if (a !== b) swapItems(perm, a, b);
    } else if (roll < 0.75 || size < 3) {
      kind = "insert";
      b = a;
      a = randomInt(rng, n);
      if (a !== b) moveItem(perm, a, b);
    } else {
      kind = "reverse";
      b = randomInt(rng, size);
      if (a > b) [a, b] = [b, a];
      if (a !== b) reverseRange(perm, a, b);
    }

    if (a !== b) {
      const next = evaluate(p, perm, scratch);
      const delta = next - current;
      if (delta <= 0 || rng() < acceptance(delta / temperature)) {
        current = next;
        k = scratch.k;
        if (current < best) {
          best = current;
          bestPerm.set(perm);
        }
      } else if (kind === "swap") {
        swapItems(perm, a, b);
      } else if (kind === "insert") {
        moveItem(perm, b, a);
      } else {
        reverseRange(perm, a, b);
      }
    }

    if (
      Math.floor(((step + 1) * TRACE_POINTS) / iterations) >
      Math.floor((step * TRACE_POINTS) / iterations)
    ) {
      trace.best.push(best);
      trace.current.push(current);
    }
  }

  best = polish(p, bestPerm, scratch, best);
  evaluate(p, bestPerm, scratch);
  trace.best.push(best);
  trace.current.push(best);

  const order = Array.from(bestPerm.subarray(0, scratch.k));
  return {
    order,
    totalSec: scratch.totalSec,
    cost: breakdown(p, input, order),
    cleanShare: cleanShareOf(p, order, order.length),
    baseline,
    improvementPct: baseline.mean > 0 ? ((baseline.mean - best) / baseline.mean) * 100 : 0,
    trace,
    iterations,
    seed: input.seed,
  };
}

/** Scores a given play order with the same cost function the optimizer uses. */
export function scoreOrder(input: OptimizeInput, order: readonly number[]): CostBreakdown {
  return breakdown(buildProblem(input), input, order);
}
