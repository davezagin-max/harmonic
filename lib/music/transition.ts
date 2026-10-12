/**
 * The facts of one mix: how the keys relate, how far the tempo moves, and how
 * the energy changes. Computed by code from the two tracks; the UI badges, the
 * exports, and the prompt for transition notes all read these same values.
 */
import { tempoMove, type TempoMove } from "./bpm";
import { keyMove, type CamelotKey, type KeyMove } from "./camelot";

export interface Mixable {
  key: CamelotKey;
  bpm: number;
  energy: number;
}

export interface TransitionFacts {
  key: KeyMove;
  tempo: TempoMove;
  /** Incoming energy minus outgoing energy, in levels on the 1-10 scale. */
  energyChange: number;
  /** True when the key move is not a clash and the tempo is inside the pitch range. */
  clean: boolean;
}

export function transitionFacts(from: Mixable, to: Mixable): TransitionFacts {
  const key = keyMove(from.key, to.key);
  const tempo = tempoMove(from.bpm, to.bpm);
  return {
    key,
    tempo,
    energyChange: to.energy - from.energy,
    clean: key.relation !== "clash" && tempo.inRange,
  };
}

/** "+2", "-1", "0". */
export function formatEnergyChange(change: number): string {
  const rounded = Math.round(change * 10) / 10;
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : "-"}${Math.abs(rounded)}`;
}
