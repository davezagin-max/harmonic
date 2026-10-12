import { describe, expect, it } from "vitest";
import { parseDelimited } from "@/lib/crate/csv";
import { csvCell, setListCsv, setListM3u } from "@/lib/crate/export";
import { importCrate } from "@/lib/crate/import";
import { SAMPLE_TRACKS } from "@/lib/crate/sample";
import { formatClock, formatLength, planSet } from "@/lib/crate/set";
import { DEFAULT_ARC } from "@/lib/music/energy";

const order = [3, 6, 5, 11];
const set = planSet(SAMPLE_TRACKS, order, DEFAULT_ARC, 24 * 60);

describe("planSet", () => {
  it("lays tracks on a timeline: each starts where the last one's solo time ends", () => {
    expect(set.entries.map((entry) => entry.position)).toEqual([1, 2, 3, 4]);
    expect(set.entries[0].startSec).toBe(0);
    for (let i = 1; i < set.entries.length; i++) {
      const before = set.entries[i - 1];
      expect(set.entries[i].startSec).toBe(before.startSec + before.playSec);
      expect(before.playSec).toBe(before.track.durationSec - 60);
    }
    expect(set.totalSec).toBe(set.entries.reduce((sum, entry) => sum + entry.playSec, 0));
  });

  it("attaches the mix facts to every track but the last", () => {
    expect(set.entries.at(-1)?.next).toBeNull();
    expect(set.entries.slice(0, -1).every((entry) => entry.next !== null)).toBe(true);
    expect(set.stats.mixes).toBe(3);
    expect(set.stats.cleanMixes + set.stats.keyClashes).toBeLessThanOrEqual(3);
  });

  it("looks the target energy up at the middle of each track", () => {
    const first = set.entries[0];
    expect(first.midT).toBeCloseTo(first.playSec / 2 / (24 * 60), 9);
    expect(first.targetLevel).toBeGreaterThan(1);
    expect(first.targetLevel).toBeLessThan(10);
  });

  it("formats clock times and lengths", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(581)).toBe("9:41");
    expect(formatClock(3852)).toBe("1:04:12");
    expect(formatLength(45 * 60)).toBe("45 min");
    expect(formatLength(90 * 60)).toBe("1 h 30 min");
    expect(formatLength(180 * 60)).toBe("3 h");
  });
});

describe("setListCsv", () => {
  it("writes one row per track with the mix into the next one", () => {
    const rows = parseDelimited(setListCsv(set, new Map([[0, "Ride the long intro."]])));
    expect(rows).toHaveLength(5);
    expect(rows[0].slice(0, 6)).toEqual(["#", "Start", "Title", "Artist", "BPM", "Key"]);
    const [first] = rows.slice(1);
    const track = SAMPLE_TRACKS[3];
    expect(first[0]).toBe("1");
    expect(first[1]).toBe("0:00");
    expect(first[2]).toBe(track.title);
    expect(first[4]).toBe(String(track.bpm));
    expect(first[9]).toBe(set.entries[0].next?.key.label);
    expect(first[12]).toBe("Ride the long intro.");
    expect(rows[4][9]).toBe("");
  });

  it("round-trips titles with commas and quotes", () => {
    const crate = importCrate('Title,Artist,BPM,Key\n"One, ""Two""",A & B,124,8A\nNext,C,125,9A');
    if (!crate.ok) throw new Error(crate.error);
    const rows = parseDelimited(setListCsv(planSet(crate.tracks, [0, 1], DEFAULT_ARC, 600)));
    expect(rows[1][2]).toBe('One, "Two"');
    expect(rows[1][3]).toBe("A & B");
  });

  it("defuses spreadsheet formulas in imported text, but not in its own numbers", () => {
    expect(csvCell('=HYPERLINK("http://x")', true)).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+1 (Remix)", true)).toBe("'+1 (Remix)");
    expect(csvCell("-0.8%")).toBe("-0.8%");
    expect(csvCell("@handle", true)).toBe("'@handle");
    expect(csvCell("Plain title", true)).toBe("Plain title");
    const crate = importCrate("Title,Artist,BPM,Key\n=SUM(A1:A9),@evil,124,8A\nNext,C,126,9A");
    if (!crate.ok) throw new Error(crate.error);
    const csv = setListCsv(planSet(crate.tracks, [0, 1], DEFAULT_ARC, 600));
    expect(csv).toContain("'=SUM(A1:A9),'@evil");
    expect(csv).toContain("+1.6%");
    expect(csv).not.toContain("'+1.6%");
  });
});

describe("setListM3u", () => {
  it("writes extended M3U with lengths and titles, falling back to a file name", () => {
    const lines = setListM3u(set, "Harmonic set").trimEnd().split("\n");
    expect(lines[0]).toBe("#EXTM3U");
    expect(lines[1]).toBe("#PLAYLIST:Harmonic set");
    expect(lines[2]).toMatch(/^# Some tracks had no file path/);
    const track = SAMPLE_TRACKS[3];
    expect(lines[3]).toBe(`#EXTINF:${track.durationSec},${track.artist} - ${track.title}`);
    expect(lines[4]).toBe(`${track.artist} - ${track.title}.mp3`);
    expect(lines).toHaveLength(3 + 2 * 4);
  });

  it("uses the imported file paths when the crate has them", () => {
    const crate = importCrate(
      "name,artist,bpm,key,length,location\nA: Side,One/Two,124,8A,6:00,/Music/a.aiff\nB,Three,125,9A,5:00,",
    );
    if (!crate.ok) throw new Error(crate.error);
    const m3u = setListM3u(planSet(crate.tracks, [0, 1], DEFAULT_ARC, 600), "Gig\nnight");
    const lines = m3u.trimEnd().split("\n");
    expect(lines[1]).toBe("#PLAYLIST:Gig night");
    expect(lines).toContain("/Music/a.aiff");
    expect(lines).toContain("#EXTINF:360,One/Two - A: Side");
    // The second track has no path: a file-safe stand-in name is used.
    expect(lines.at(-1)).toBe("Three - B.mp3");
    const noPaths = setListM3u(planSet(crate.tracks, [0], DEFAULT_ARC, 300), "x");
    expect(noPaths).not.toContain("# Some tracks");
  });
});
