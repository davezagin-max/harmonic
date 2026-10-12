/**
 * Transition notes: one short piece of mixing advice per mix.
 *
 * The split of work is strict. The server recomputes the facts of every mix
 * from the raw tracks (key relation, tempo change, energy change) with the same
 * functions the UI badges use. The model is given those facts and only phrases
 * advice. Each note is then checked against the facts: a note that quotes a
 * BPM, a percentage, or a key that is not true for that mix is thrown away and
 * replaced by a rule-based note, so the set list never shows an invented figure.
 *
 * This file is the shared, dependency-free half (facts, fact check, fallback),
 * used by the route, the browser, and the fixture tests. The model call lives
 * in `notes-live.ts`.
 */
import { formatPct } from "../music/bpm";
import { keyCode, keyName, parseKey, type CamelotKey } from "../music/camelot";
import { formatEnergyChange, transitionFacts, type TransitionFacts } from "../music/transition";

export const MAX_SET_TRACKS = 60;
export const NOTE_MAX = 240;

/** The raw data the browser sends for one track of the set. */
export interface NoteTrack {
  title: string;
  artist: string;
  /** Camelot code, "8A". The server parses it; nothing else about the key is trusted. */
  key: string;
  bpm: number;
  energy: number;
}

export interface MixNote {
  /** 0-based: mix 0 is from track 1 into track 2. */
  index: number;
  note: string;
  /** "rule" when the model's note was missing or failed the fact check. */
  source: "model" | "rule";
}

export interface NotesResult {
  notes: MixNote[];
}

/** One mix with everything the model is allowed to know about it. */
export interface Mix {
  index: number;
  from: NoteTrack & { camelot: CamelotKey };
  to: NoteTrack & { camelot: CamelotKey };
  facts: TransitionFacts;
}

/** Recomputes the facts of every mix in the set from the raw tracks. */
export function buildMixes(tracks: readonly NoteTrack[]): Mix[] {
  const withKeys = tracks.map((track) => {
    const camelot = parseKey(track.key);
    if (!camelot) throw new Error(`"${track.key}" is not a Camelot key.`);
    return { ...track, camelot };
  });
  return withKeys.slice(0, -1).map((from, index) => {
    const to = withKeys[index + 1];
    return {
      index,
      from,
      to,
      facts: transitionFacts(
        { key: from.camelot, bpm: from.bpm, energy: from.energy },
        { key: to.camelot, bpm: to.bpm, energy: to.energy },
      ),
    };
  });
}

const label = (track: NoteTrack) =>
  track.artist ? `${track.artist} - ${track.title}` : track.title;
const keyLabel = (key: CamelotKey) => `${keyCode(key)} (${keyName(key)})`;

/** The JSON the model sees for one mix. Every value is computed, none is free text from us. */
export function mixForPrompt(mix: Mix) {
  const { facts } = mix;
  return {
    index: mix.index,
    from: label(mix.from),
    to: label(mix.to),
    fromKey: keyLabel(mix.from.camelot),
    toKey: keyLabel(mix.to.camelot),
    keyMove: facts.key.label,
    keysCompatible: facts.key.relation !== "clash",
    fromBpm: mix.from.bpm,
    toBpm: mix.to.bpm,
    tempoChange: formatPct(facts.tempo.pct),
    tempoMatch: facts.tempo.match,
    tempoInPitchRange: facts.tempo.inRange,
    fromEnergy: mix.from.energy,
    toEnergy: mix.to.energy,
    energyChange: formatEnergyChange(facts.energyChange),
  };
}

const PERCENT = /(\d+(?:\.\d+)?)\s*(?:%|percent)/gi;
const BPM = /(\d+(?:\.\d+)?)\s*bpm/gi;
const CAMELOT_CODE = /\b(0?[1-9]|1[0-2])([AB])\b/g;

/**
 * The fact check. Returns the reason a note is unusable, or null when it is fine.
 * A note may quote a figure only if that figure is true for this mix.
 */
export function noteProblem(mix: Mix, note: string): string | null {
  const text = note.trim();
  if (!text) return "empty";
  if (text.length > NOTE_MAX) return "too long";

  const tempo = Math.abs(mix.facts.tempo.pct);
  for (const match of text.matchAll(PERCENT)) {
    if (Math.abs(Number(match[1]) - tempo) > 0.15) return `states ${match[0]}`;
  }
  const allowedBpm = [mix.from.bpm, mix.to.bpm, Math.abs(mix.to.bpm - mix.from.bpm)];
  for (const match of text.matchAll(BPM)) {
    const value = Number(match[1]);
    if (!allowedBpm.some((bpm) => Math.abs(bpm - value) <= 0.5)) return `states ${match[0]}`;
  }
  const allowedKeys = new Set([keyCode(mix.from.camelot), keyCode(mix.to.camelot)]);
  for (const match of text.matchAll(CAMELOT_CODE)) {
    if (!allowedKeys.has(`${Number(match[1])}${match[2]}`)) return `states key ${match[0]}`;
  }
  return null;
}

/** A plain note built from the facts alone, used when the model's note is missing or wrong. */
export function ruleNote(mix: Mix): string {
  const { key, tempo, energyChange } = mix.facts;
  const keyPart: Record<typeof key.relation, string> = {
    same: "Same key, so a long blend is safe",
    adjacent: "Neighbouring keys, so a long blend works",
    relative: "Relative keys share their notes; blend freely and let the mood shift",
    boost: "Two steps up the wheel; swap quickly for the lift",
    clash: "Keys clash; keep the overlap short or mix on drums only",
  };
  const tempoPart = !tempo.inRange
    ? "the tempo gap is outside the pitch range, so cut or echo out instead of beat-matching"
    : Math.abs(tempo.pct) < 0.05
      ? "tempos already match"
      : `nudge the pitch ${formatPct(tempo.pct)}`;
  const energyPart =
    energyChange >= 2 ? " Energy jumps here." : energyChange <= -2 ? " Energy drops here." : "";
  return `${keyPart[key.relation]}; ${tempoPart}.${energyPart}`;
}

/**
 * Keeps the first note per mix that passes the fact check.
 * Returns the accepted notes and the indexes still missing.
 */
export function acceptNotes(
  mixes: readonly Mix[],
  candidates: readonly { index: number; note: string }[],
  accepted: Map<number, string> = new Map(),
): { accepted: Map<number, string>; missing: number[] } {
  for (const candidate of candidates) {
    const mix = Number.isInteger(candidate.index) ? mixes[candidate.index] : undefined;
    if (!mix || accepted.has(mix.index)) continue;
    const note = candidate.note.replace(/\s+/g, " ").trim();
    if (noteProblem(mix, note) === null) accepted.set(mix.index, note);
  }
  return {
    accepted,
    missing: mixes.filter((mix) => !accepted.has(mix.index)).map((mix) => mix.index),
  };
}

/** Final list: the accepted note for each mix, or the rule-based one. */
export function finishNotes(
  mixes: readonly Mix[],
  accepted: ReadonlyMap<number, string>,
): MixNote[] {
  return mixes.map((mix) => {
    const note = accepted.get(mix.index);
    return note
      ? { index: mix.index, note, source: "model" as const }
      : { index: mix.index, note: ruleNote(mix), source: "rule" as const };
  });
}

/**
 * Validates a stored or returned result against a set: every mix has exactly
 * one note, and every model note passes the fact check for that mix. Used by
 * the browser before showing notes and by the fixture tests.
 */
export function notesFit(mixes: readonly Mix[], result: NotesResult): boolean {
  if (result.notes.length !== mixes.length) return false;
  return result.notes.every(
    (note, position) =>
      note.index === position &&
      (note.source === "rule" || noteProblem(mixes[position], note.note) === null),
  );
}
