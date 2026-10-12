/**
 * A planned set: the chosen tracks on a timeline, with the facts of each mix.
 * Everything the set list, the wheel path, the arc overlay, and the exports
 * show is derived here from the crate and the optimizer's play order.
 */
import { energyAt, toLevel, type ArcPoint } from "../music/energy";
import { transitionFacts, type TransitionFacts } from "../music/transition";
import { playSeconds, type Track } from "./types";

export interface SetEntry {
  /** 1-based position in the set. */
  position: number;
  track: Track;
  startSec: number;
  playSec: number;
  /** Where the middle of this track falls in the target length, 0-1. */
  midT: number;
  /** Target energy level (1-10) at that point of the arc. */
  targetLevel: number;
  /** The mix into the next track, or null for the last one. */
  next: TransitionFacts | null;
}

export interface SetStats {
  mixes: number;
  /** Mixes with a compatible key and an in-range tempo. */
  cleanMixes: number;
  keyClashes: number;
  tempoOutOfRange: number;
  /** Mean absolute tempo change across mixes, in percent. */
  avgTempoPct: number;
  /** Mean distance between each track's energy and the arc, in levels. */
  avgEnergyMiss: number;
}

export interface PlannedSet {
  entries: SetEntry[];
  totalSec: number;
  stats: SetStats;
}

export function planSet(
  tracks: readonly Track[],
  order: readonly number[],
  arc: readonly ArcPoint[],
  targetSec: number,
): PlannedSet {
  const chosen = order.map((index) => tracks[index]).filter((track) => track !== undefined);
  const entries: SetEntry[] = [];
  let elapsed = 0;
  chosen.forEach((track, i) => {
    const playSec = playSeconds(track);
    const midT = Math.min(1, (elapsed + playSec / 2) / Math.max(1, targetSec));
    const following = chosen[i + 1];
    entries.push({
      position: i + 1,
      track,
      startSec: elapsed,
      playSec,
      midT,
      targetLevel: toLevel(energyAt(arc, midT)),
      next: following ? transitionFacts(track, following) : null,
    });
    elapsed += playSec;
  });

  const mixes = entries.filter((entry) => entry.next !== null);
  const facts = mixes.map((entry) => entry.next as TransitionFacts);
  const mean = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    entries,
    totalSec: elapsed,
    stats: {
      mixes: facts.length,
      cleanMixes: facts.filter((fact) => fact.clean).length,
      keyClashes: facts.filter((fact) => fact.key.relation === "clash").length,
      tempoOutOfRange: facts.filter((fact) => !fact.tempo.inRange).length,
      avgTempoPct: mean(facts.map((fact) => Math.abs(fact.tempo.pct))),
      avgEnergyMiss: mean(entries.map((entry) => Math.abs(entry.track.energy - entry.targetLevel))),
    },
  };
}

/** "0:00", "9:41", "1:04:12". */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "45 min", "1 h 30 min", "3 h". */
export function formatLength(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
