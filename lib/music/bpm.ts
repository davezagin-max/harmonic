/**
 * Tempo rules. A DJ deck's pitch fader moves a track a few percent either way;
 * this app treats ±6% as the usable range. A track at roughly half or double
 * the tempo of the one before it can still be beat-matched (87 against 174),
 * so those are recognised and costed as a match with a small surcharge.
 */

export const PITCH_RANGE_PCT = 6;

export type TempoMatch = "straight" | "half" | "double";

export interface TempoMove {
  /**
   * How much faster (+) or slower (-) the incoming track runs than the outgoing
   * one, in percent, after choosing the closest of straight, half-time, or
   * double-time. This is the pitch change needed to beat-match the two.
   */
  pct: number;
  /** "half": the incoming track is about half the tempo. "double": about double. */
  match: TempoMatch;
  inRange: boolean;
  /** 0-1 inside the pitch range, 2-5 outside it. */
  cost: number;
}

const HALF_DOUBLE_SURCHARGE = 0.15;

export function tempoMove(fromBpm: number, toBpm: number): TempoMove {
  const candidates: { match: TempoMatch; bpm: number }[] = [
    { match: "straight", bpm: toBpm },
    { match: "half", bpm: toBpm * 2 },
    { match: "double", bpm: toBpm / 2 },
  ];
  let best = candidates[0];
  let bestPct = ((best.bpm - fromBpm) / fromBpm) * 100;
  for (const candidate of candidates.slice(1)) {
    const pct = ((candidate.bpm - fromBpm) / fromBpm) * 100;
    if (Math.abs(pct) < Math.abs(bestPct)) {
      best = candidate;
      bestPct = pct;
    }
  }
  const size = Math.abs(bestPct);
  const inRange = size <= PITCH_RANGE_PCT;
  // Linear inside the range; a step up to 2 at the edge plus a slope beyond it,
  // so an out-of-range mix is always far worse than any in-range one but the
  // search can still tell a 7% jump from a 20% one.
  const base = inRange ? size / PITCH_RANGE_PCT : 2 + Math.min(3, (size - PITCH_RANGE_PCT) / 4);
  const cost = base + (best.match === "straight" ? 0 : HALF_DOUBLE_SURCHARGE);
  return { pct: bestPct, match: best.match, inRange, cost };
}

/** "+1.6%", "-0.8%", "0%". One decimal place, no "-0.0%". */
export function formatPct(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : "-"}${Math.abs(rounded).toFixed(1)}%`;
}
