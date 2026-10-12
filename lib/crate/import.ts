/**
 * Turns an exported track list into a crate. The header row is matched
 * loosely, so the same code reads Rekordbox, Serato, Traktor, Mixed In Key and
 * hand-made files. Nothing here touches the network: a visitor's file is parsed
 * in their browser.
 */
import { parseKey } from "../music/camelot";
import { detectDelimiter, parseDelimited, stripBom, type Delimiter } from "./csv";
import { DEFAULT_DURATION_SEC, type Track } from "./types";

export const MAX_TRACKS = 500;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export type Layout = "Rekordbox" | "Serato" | "Traktor" | "Mixed In Key" | "Generic";

type Field = "title" | "artist" | "bpm" | "key" | "energy" | "genre" | "duration" | "path";

/** Header names, lower-cased with everything but letters and digits removed. */
const ALIASES: Record<Field, string[]> = {
  title: ["title", "tracktitle", "name", "trackname", "song", "songtitle", "track"],
  artist: ["artist", "artists", "artistname", "trackartist"],
  bpm: ["bpm", "tempo", "averagebpm"],
  key: [
    "key",
    "camelot",
    "camelotkey",
    "keyresult",
    "initialkey",
    "musicalkey",
    "openkey",
    "keytext",
    "tonality",
  ],
  energy: ["energy", "energylevel"],
  genre: ["genre", "style"],
  duration: ["time", "length", "duration", "totaltime", "tracktime", "playtime"],
  path: ["location", "filepath", "path", "file", "filename", "url"],
};

export interface SkippedRow {
  /** 1-based line of the data row in the file, counting the header. */
  row: number;
  reason: string;
}

export interface ImportReport {
  layout: Layout;
  delimiter: Delimiter;
  /** Data rows found (not counting the header). */
  rows: number;
  imported: number;
  skippedCount: number;
  /** The first few skipped rows, with the reason for each. */
  skipped: SkippedRow[];
  /** Tracks whose energy was missing and was derived from tempo. */
  energyDerived: number;
  /** Tracks whose length was missing and was assumed. */
  durationAssumed: number;
  hasPaths: boolean;
  /** True when the file had more rows than `MAX_TRACKS`. */
  truncated: boolean;
}

export type ImportResult =
  { ok: true; tracks: Track[]; report: ImportReport } | { ok: false; error: string };

const normalizeHeader = (cell: string) => cell.toLowerCase().replace(/[^a-z0-9]/g, "");

function mapHeader(cells: string[]): Partial<Record<Field, number>> {
  const normalized = cells.map(normalizeHeader);
  const columns: Partial<Record<Field, number>> = {};
  for (const field of Object.keys(ALIASES) as Field[]) {
    // Earlier aliases win, so "Track Title" beats a bare "#"-style "Track" column.
    for (const alias of ALIASES[field]) {
      const index = normalized.indexOf(alias);
      if (index !== -1) {
        columns[field] = index;
        break;
      }
    }
  }
  return columns;
}

export function parseBpm(cell: string): number | null {
  const cleaned = cell.trim().replace(/[^0-9.,]/g, "");
  if (!cleaned) return null;
  const value = Number(
    cleaned.includes(".") ? cleaned.replaceAll(",", "") : cleaned.replace(",", "."),
  );
  if (!Number.isFinite(value) || value < 40 || value > 250) return null;
  return Math.round(value * 100) / 100;
}

/** "6:32", "1:02:03", "392" (seconds) or "392000" (milliseconds) to seconds. */
export function parseDuration(cell: string): number | null {
  const value = cell.trim();
  if (!value) return null;
  let seconds: number;
  if (value.includes(":")) {
    const parts = value.split(":").map((part) => Number(part));
    if (parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
    seconds = parts.reduce((total, part) => total * 60 + part, 0);
  } else {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    seconds = number > 20_000 ? number / 1000 : number;
  }
  if (seconds < 30 || seconds > 3600) return null;
  return Math.round(seconds);
}

function parseEnergy(cell: string): number | null {
  const value = Number(cell.trim().replace(",", "."));
  if (!cell.trim() || !Number.isFinite(value) || value < 1 || value > 10) return null;
  return Math.round(value);
}

/** "Music/House/Marlo Venn - Open Fader.aiff" to artist and title. */
function fromFileName(path: string): { title: string; artist: string } {
  const base = (path.split(/[\\/]/).pop() ?? "").replace(/\.[A-Za-z0-9]{2,5}$/, "");
  const dash = base.indexOf(" - ");
  if (dash === -1) return { title: base.trim(), artist: "" };
  return { artist: base.slice(0, dash).trim(), title: base.slice(dash + 3).trim() };
}

function guessLayout(
  header: string[],
  columns: Partial<Record<Field, number>>,
  rows: string[][],
): Layout {
  const names = header.map(normalizeHeader);
  if (names.includes("keyresult")) return "Mixed In Key";
  if (names.includes("tracktitle")) return "Rekordbox";
  if (columns.key !== undefined) {
    const keys = rows.slice(0, 40).map((row) => (row[columns.key as number] ?? "").trim());
    const openKey = keys.filter((key) => /^(0?[1-9]|1[0-2])[md]$/i.test(key)).length;
    if (keys.length > 0 && openKey > keys.length / 2) return "Traktor";
  }
  if (names.includes("name") && !names.includes("title")) return "Serato";
  return "Generic";
}

/**
 * Parses an exported track list. Rows without a title, a usable BPM, or a key
 * this app can read are skipped and reported. A missing energy value is filled
 * with a stand-in derived from tempo and flagged on the track.
 */
export function importCrate(input: string): ImportResult {
  const text = stripBom(input);
  if (!text.trim()) return { ok: false, error: "That file is empty." };
  const delimiter = detectDelimiter(text);
  const table = parseDelimited(text, delimiter);

  // The header is the first of the opening rows that names a BPM or key column.
  let headerIndex = -1;
  let columns: Partial<Record<Field, number>> = {};
  for (let i = 0; i < Math.min(table.length, 5); i++) {
    const candidate = mapHeader(table[i]);
    if (candidate.bpm !== undefined && candidate.key !== undefined) {
      headerIndex = i;
      columns = candidate;
      break;
    }
  }
  if (headerIndex === -1) {
    return {
      ok: false,
      error:
        "Could not find BPM and Key columns in the header row. The file needs at least Title, BPM and Key.",
    };
  }
  if (columns.title === undefined && columns.path === undefined) {
    return { ok: false, error: "Could not find a Title (or File name) column in the header row." };
  }

  const dataRows = table.slice(headerIndex + 1);
  const cell = (row: string[], field: Field) => {
    const index = columns[field];
    return index === undefined ? "" : (row[index] ?? "").trim();
  };

  const tracks: Track[] = [];
  const missingEnergy: Track[] = [];
  const skipped: SkippedRow[] = [];
  let skippedCount = 0;
  let durationAssumed = 0;
  let truncated = false;
  const skip = (index: number, reason: string) => {
    skippedCount++;
    if (skipped.length < 8) skipped.push({ row: headerIndex + index + 2, reason });
  };

  dataRows.forEach((row, index) => {
    if (tracks.length >= MAX_TRACKS) {
      truncated = true;
      return;
    }
    const path = cell(row, "path") || null;
    let title = cell(row, "title");
    let artist = cell(row, "artist");
    if (!title && path) {
      const named = fromFileName(path);
      title = named.title;
      artist = artist || named.artist;
    }
    if (!title) return skip(index, "no title");
    const bpm = parseBpm(cell(row, "bpm"));
    if (bpm === null) return skip(index, `no usable BPM ("${cell(row, "bpm").slice(0, 20)}")`);
    const key = parseKey(cell(row, "key"));
    if (!key) return skip(index, `unreadable key ("${cell(row, "key").slice(0, 20)}")`);

    const energy = parseEnergy(cell(row, "energy"));
    const duration = parseDuration(cell(row, "duration"));
    if (duration === null) durationAssumed++;
    const track: Track = {
      id: `t${String(tracks.length + 1).padStart(3, "0")}`,
      title: title.slice(0, 160),
      artist: artist.slice(0, 160),
      bpm,
      key,
      energy: energy ?? 5,
      energyDerived: energy === null,
      genre: cell(row, "genre").slice(0, 60),
      durationSec: duration ?? DEFAULT_DURATION_SEC,
      durationAssumed: duration === null,
      path,
    };
    if (energy === null) missingEnergy.push(track);
    tracks.push(track);
  });

  if (tracks.length === 0) {
    return {
      ok: false,
      error:
        skippedCount > 0
          ? `No usable tracks: all ${skippedCount} rows were skipped (first reason: ${skipped[0].reason}).`
          : "The file has a header row but no tracks.",
    };
  }

  // Stand-in energy: where the track's tempo sits in this crate's tempo range, mapped to levels 3-8.
  if (missingEnergy.length > 0) {
    const tempos = tracks.map((track) => track.bpm);
    const slowest = Math.min(...tempos);
    const fastest = Math.max(...tempos);
    for (const track of missingEnergy) {
      track.energy =
        fastest === slowest ? 5 : Math.round(3 + (5 * (track.bpm - slowest)) / (fastest - slowest));
    }
  }

  return {
    ok: true,
    tracks,
    report: {
      layout: guessLayout(table[headerIndex], columns, dataRows),
      delimiter,
      rows: dataRows.length,
      imported: tracks.length,
      skippedCount,
      skipped,
      energyDerived: missingEnergy.length,
      durationAssumed,
      hasPaths: tracks.some((track) => track.path !== null),
      truncated,
    },
  };
}
