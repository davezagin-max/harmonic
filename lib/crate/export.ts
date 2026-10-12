/**
 * Set list exports: a CSV for reading or printing and an extended M3U for
 * loading into DJ software.
 */
import { formatPct } from "../music/bpm";
import { keyCode, keyName } from "../music/camelot";
import { formatEnergyChange } from "../music/transition";
import { formatClock, type PlannedSet } from "./set";

/**
 * Quotes a cell when it needs it. Text that came from an imported file or from
 * the model is also defused against spreadsheet formula injection: a cell that
 * starts with =, +, -, @, tab or carriage return gets a leading apostrophe, so
 * a track titled "=HYPERLINK(...)" opens as text.
 */
export function csvCell(value: string | number, untrustedText = false): string {
  let text = String(value);
  if (untrustedText && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const HEADER = [
  "#",
  "Start",
  "Title",
  "Artist",
  "BPM",
  "Key",
  "Musical key",
  "Energy",
  "Genre",
  "Mix into next",
  "Tempo change",
  "Energy change",
  "Note",
];

/** One row per track; the mix columns describe the move into the following track. */
export function setListCsv(
  set: PlannedSet,
  notes: ReadonlyMap<number, string> = new Map(),
): string {
  const lines = [HEADER.join(",")];
  set.entries.forEach((entry, index) => {
    const { track, next } = entry;
    lines.push(
      [
        csvCell(entry.position),
        csvCell(formatClock(entry.startSec)),
        csvCell(track.title, true),
        csvCell(track.artist, true),
        csvCell(track.bpm),
        csvCell(keyCode(track.key)),
        csvCell(keyName(track.key)),
        csvCell(track.energy),
        csvCell(track.genre, true),
        csvCell(next ? next.key.label : ""),
        csvCell(next ? tempoText(next.tempo.pct, next.tempo.match) : ""),
        csvCell(next ? formatEnergyChange(next.energyChange) : ""),
        csvCell(notes.get(index) ?? "", true),
      ].join(","),
    );
  });
  return lines.join("\r\n") + "\r\n";
}

function tempoText(pct: number, match: "straight" | "half" | "double"): string {
  const base = formatPct(pct);
  return match === "straight" ? base : `${base} (${match}-time)`;
}

const oneLine = (text: string) => text.replace(/[\r\n]+/g, " ").trim();

/** A file name to stand in for a missing path: no separators or reserved characters. */
function fallbackName(artist: string, title: string): string {
  const name = artist ? `${artist} - ${title}` : title;
  return (
    oneLine(name)
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim() + ".mp3"
  );
}

/**
 * Extended M3U. Uses the file path from the import when there was one. A crate
 * imported without paths gets "Artist - Title.mp3" names and a comment saying so,
 * since the player will need to be pointed at the folder that holds the files.
 */
export function setListM3u(set: PlannedSet, name: string): string {
  const lines = ["#EXTM3U", `#PLAYLIST:${oneLine(name)}`];
  if (set.entries.some((entry) => entry.track.path === null)) {
    lines.push(
      '# Some tracks had no file path in the import; those entries use "Artist - Title.mp3" names.',
    );
  }
  for (const { track } of set.entries) {
    const label = track.artist ? `${track.artist} - ${track.title}` : track.title;
    lines.push(`#EXTINF:${Math.round(track.durationSec)},${oneLine(label)}`);
    lines.push(track.path ? oneLine(track.path) : fallbackName(track.artist, track.title));
  }
  return lines.join("\n") + "\n";
}
