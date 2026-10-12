import type { CamelotKey } from "../music/camelot";

export interface Track {
  /** Stable within one crate ("t001"). */
  id: string;
  title: string;
  artist: string;
  bpm: number;
  key: CamelotKey;
  /** 1-10, the scale Mixed In Key uses. */
  energy: number;
  /** True when the import had no energy value and a stand-in was derived from tempo. */
  energyDerived: boolean;
  genre: string;
  durationSec: number;
  /** True when the import had no length and the default was used. */
  durationAssumed: boolean;
  /** File location from the import, when it had one. Used only for the M3U export. */
  path: string | null;
}

/** Seconds of the next track that overlap the current one during a mix. */
export const BLEND_SEC = 60;
export const DEFAULT_DURATION_SEC = 360;

/** How long a track holds the floor on its own: its length minus one blend. */
export function playSeconds(track: Pick<Track, "durationSec">): number {
  return Math.max(60, track.durationSec - BLEND_SEC);
}
