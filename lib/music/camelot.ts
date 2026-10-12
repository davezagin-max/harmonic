/**
 * Camelot wheel rules as pure functions.
 *
 * Every key notation a DJ tool exports is parsed into one representation:
 * a wheel position 1-12 and a ring. Ring "A" is minor (inner ring), ring "B"
 * is major (outer ring). One step clockwise on the wheel is a perfect fifth up.
 */

export type Ring = "A" | "B";

export interface CamelotKey {
  /** Wheel position, 1-12. */
  n: number;
  /** "A" = minor, "B" = major. */
  ring: Ring;
}

/** Major key names by wheel position (index 0 is position 1). */
const MAJOR_NAMES = ["B", "F#", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E"];
/** Minor key names by wheel position (index 0 is position 1). */
const MINOR_NAMES = ["Abm", "Ebm", "Bbm", "Fm", "Cm", "Gm", "Dm", "Am", "Em", "Bm", "F#m", "Dbm"];

const NOTE_PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function camelotKey(n: number, ring: Ring): CamelotKey {
  return { n, ring };
}

/** "8A", "12B". */
export function keyCode(key: CamelotKey): string {
  return `${key.n}${key.ring}`;
}

/** Dense index 0-23, handy for lookup tables. */
export function keyIndex(key: CamelotKey): number {
  return (key.n - 1) * 2 + (key.ring === "B" ? 1 : 0);
}

export function keyFromIndex(index: number): CamelotKey {
  return { n: Math.floor(index / 2) + 1, ring: index % 2 === 1 ? "B" : "A" };
}

/** Musical name: "Am", "C", "F#m". */
export function keyName(key: CamelotKey): string {
  return (key.ring === "B" ? MAJOR_NAMES : MINOR_NAMES)[key.n - 1];
}

/** Open Key notation used by Traktor: "1m" is A minor, "1d" is C major. */
export function openKeyCode(key: CamelotKey): string {
  const n = ((key.n + 4) % 12) + 1;
  return `${n}${key.ring === "B" ? "d" : "m"}`;
}

export function sameKey(a: CamelotKey, b: CamelotKey): boolean {
  return a.n === b.n && a.ring === b.ring;
}

/** Wheel position of the major key whose root has this pitch class (C = 0). */
function majorPosition(pitchClass: number): number {
  return ((pitchClass * 7 + 7) % 12) + 1;
}

const CAMELOT = /^(0?[1-9]|1[0-2])\s*([AB])$/i;
const OPEN_KEY = /^(0?[1-9]|1[0-2])\s*([MD])$/i;
const MUSICAL = /^([A-G])\s*(#|♯|b|♭|sharp|flat)?\s*(.*)$/i;
const MINOR_WORDS = new Set(["m", "min", "minor", "mi", "-"]);
const MAJOR_WORDS = new Set(["", "maj", "major", "ma"]);

function parseOne(text: string): CamelotKey | null {
  const value = text.trim();
  if (!value) return null;

  const camelot = CAMELOT.exec(value);
  if (camelot) {
    return { n: Number(camelot[1]), ring: camelot[2].toUpperCase() as Ring };
  }

  const open = OPEN_KEY.exec(value);
  if (open) {
    const n = ((Number(open[1]) + 6) % 12) + 1;
    return { n, ring: open[2].toLowerCase() === "d" ? "B" : "A" };
  }

  const musical = MUSICAL.exec(value);
  if (!musical) return null;
  const [, letter, accidental = "", rest] = musical;
  let pitch = NOTE_PITCH[letter.toUpperCase()];
  const mark = accidental.toLowerCase();
  if (mark === "#" || mark === "♯" || mark === "sharp") pitch += 1;
  if (mark === "b" || mark === "♭" || mark === "flat") pitch -= 1;
  pitch = (pitch + 12) % 12;

  const suffix = rest.trim();
  // A bare capital "M" means major; every other spelling is case-insensitive.
  const word = suffix === "M" ? "maj" : suffix.toLowerCase();
  if (MINOR_WORDS.has(word)) return { n: majorPosition((pitch + 3) % 12), ring: "A" };
  if (MAJOR_WORDS.has(word)) return { n: majorPosition(pitch), ring: "B" };
  return null;
}

/**
 * Parses Camelot ("8A"), Open Key ("1m", "1d"), and musical ("Am", "C",
 * "F#m", "Bb minor", "D♭maj") notation. Returns null when the text is not a key.
 * A cell holding two spellings ("F#m/Gbm", "8A / Am") resolves to the first one that parses.
 */
export function parseKey(text: string): CamelotKey | null {
  if (typeof text !== "string") return null;
  const whole = parseOne(text);
  if (whole) return whole;
  for (const part of text.split(/[/|,;]|\s-\s/)) {
    const key = parseOne(part);
    if (key) return key;
  }
  return null;
}

export type Relation = "same" | "adjacent" | "relative" | "boost" | "clash";

export interface KeyMove {
  relation: Relation;
  /** Signed steps around the wheel from the first key to the second, -5 to +6. */
  steps: number;
  ringChange: boolean;
  /** 0 (perfect) to 1 (worst clash). */
  cost: number;
  /** Short badge text: "Same key", "+1", "Relative major", "Energy boost +2", "Clash". */
  label: string;
}

const RELATION_COST: Record<Exclude<Relation, "clash">, number> = {
  same: 0,
  adjacent: 0.1,
  relative: 0.15,
  boost: 0.3,
};

/** Signed shortest way round the wheel, in the range -5..+6. */
export function wheelSteps(from: number, to: number): number {
  const forward = (((to - from) % 12) + 12) % 12;
  return forward > 6 ? forward - 12 : forward;
}

/**
 * Classifies the move from one key to the next.
 *
 * - same: identical key.
 * - adjacent: one step either way on the same ring (a fifth up or down).
 * - relative: same position, other ring (relative major or minor; same notes).
 * - boost: two steps clockwise on the same ring (up a whole tone), the classic "energy boost".
 * - clash: everything else, graded by how far round the wheel the move goes.
 */
export function keyMove(from: CamelotKey, to: CamelotKey): KeyMove {
  const steps = wheelSteps(from.n, to.n);
  const ringChange = from.ring !== to.ring;
  const distance = Math.abs(steps);

  if (distance === 0 && !ringChange) {
    return { relation: "same", steps, ringChange, cost: RELATION_COST.same, label: "Same key" };
  }
  if (distance === 0 && ringChange) {
    return {
      relation: "relative",
      steps,
      ringChange,
      cost: RELATION_COST.relative,
      label: to.ring === "B" ? "Relative major" : "Relative minor",
    };
  }
  if (distance === 1 && !ringChange) {
    return {
      relation: "adjacent",
      steps,
      ringChange,
      cost: RELATION_COST.adjacent,
      label: steps > 0 ? "+1 on the wheel" : "-1 on the wheel",
    };
  }
  if (steps === 2 && !ringChange) {
    return {
      relation: "boost",
      steps,
      ringChange,
      cost: RELATION_COST.boost,
      label: "Energy boost +2",
    };
  }
  const cost = Math.min(1, 0.4 + 0.1 * distance + (ringChange ? 0.05 : 0));
  const label = distance === 1 ? "Diagonal clash" : `Clash, ${distance} steps`;
  return { relation: "clash", steps, ringChange, cost, label };
}

/** The keys a track in `key` can move to without a clash, with the relation for each. */
export function compatibleKeys(key: CamelotKey): { key: CamelotKey; relation: Relation }[] {
  const wrap = (n: number) => ((((n - 1) % 12) + 12) % 12) + 1;
  return [
    { key, relation: "same" },
    { key: { n: wrap(key.n + 1), ring: key.ring }, relation: "adjacent" },
    { key: { n: wrap(key.n - 1), ring: key.ring }, relation: "adjacent" },
    { key: { n: key.n, ring: key.ring === "A" ? "B" : "A" }, relation: "relative" },
    { key: { n: wrap(key.n + 2), ring: key.ring }, relation: "boost" },
  ];
}
