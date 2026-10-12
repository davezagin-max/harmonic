import { describe, expect, it } from "vitest";
import { decodeText, detectDelimiter, parseDelimited } from "@/lib/crate/csv";
import { importCrate, MAX_TRACKS, parseBpm, parseDuration } from "@/lib/crate/import";
import { SAMPLE_CRATE_CSV, SAMPLE_TRACKS } from "@/lib/crate/sample";
import { keyCode } from "@/lib/music/camelot";

function imported(text: string) {
  const result = importCrate(text);
  if (!result.ok) throw new Error(result.error);
  return result;
}

function utf16le(text: string, bom = true): Uint8Array {
  const bytes = new Uint8Array(text.length * 2 + (bom ? 2 : 0));
  let offset = 0;
  if (bom) {
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    offset = 2;
  }
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    bytes[offset + i * 2] = unit & 0xff;
    bytes[offset + i * 2 + 1] = unit >> 8;
  }
  return bytes;
}

describe("parseDelimited", () => {
  it("keeps commas, doubled quotes, and line breaks inside quoted fields", () => {
    const rows = parseDelimited('a,b,c\r\n"one, two","say ""hi""","line 1\nline 2"\r\nx,y,z');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["one, two", 'say "hi"', "line 1\nline 2"],
      ["x", "y", "z"],
    ]);
  });

  it("drops blank lines and handles a missing final newline and bare CR endings", () => {
    expect(parseDelimited("a,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseDelimited("a,b\r1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty fields in place", () => {
    expect(parseDelimited("a,,c\n,,")).toEqual([["a", "", "c"]]);
    expect(parseDelimited("a,b,c\n1,,")).toEqual([
      ["a", "b", "c"],
      ["1", "", ""],
    ]);
  });

  it("detects tabs and semicolons", () => {
    expect(detectDelimiter("Title\tArtist\tBPM\nA, B\tC\t120")).toBe("\t");
    expect(detectDelimiter("Title;Artist;BPM\nA;B;124,5")).toBe(";");
    expect(detectDelimiter('"Title, with comma";Artist;BPM')).toBe(";");
    expect(detectDelimiter("Title,Artist,BPM")).toBe(",");
  });

  it("does not treat a quote in a tab-separated title as the start of a quoted field", () => {
    const rows = parseDelimited('Title\tBPM\n"Heroes" (12" Mix)\t124\nNext\t125');
    expect(rows[1]).toEqual(['"Heroes" (12" Mix)', "124"]);
    expect(rows).toHaveLength(3);
  });
});

describe("decodeText", () => {
  it("strips a UTF-8 byte-order mark", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Title,BPM")]);
    expect(decodeText(bytes)).toBe("Title,BPM");
  });

  it("reads UTF-16 with a byte-order mark, as Rekordbox writes it", () => {
    expect(decodeText(utf16le("Track Title\tBPM\nCafé del Sol\t122"))).toBe(
      "Track Title\tBPM\nCafé del Sol\t122",
    );
  });

  it("spots UTF-16 without a byte-order mark", () => {
    expect(decodeText(utf16le("Title,BPM,Key\nOpen Fader,124,8A", false))).toBe(
      "Title,BPM,Key\nOpen Fader,124,8A",
    );
  });
});

describe("field parsers", () => {
  it("reads BPM with decimals, decimal commas, and units", () => {
    expect(parseBpm("124")).toBe(124);
    expect(parseBpm("124.00")).toBe(124);
    expect(parseBpm("123,5")).toBe(123.5);
    expect(parseBpm(" 126 bpm ")).toBe(126);
    expect(parseBpm("")).toBeNull();
    expect(parseBpm("fast")).toBeNull();
    expect(parseBpm("0")).toBeNull();
    expect(parseBpm("999")).toBeNull();
  });

  it("reads track lengths as clock times, seconds, or milliseconds", () => {
    expect(parseDuration("6:32")).toBe(392);
    expect(parseDuration("06:32")).toBe(392);
    expect(parseDuration("0:06:32")).toBe(392);
    expect(parseDuration("392")).toBe(392);
    expect(parseDuration("392000")).toBe(392);
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("5")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
  });
});

describe("importCrate", () => {
  it("imports the bundled sample crate through the same path as a visitor's file", () => {
    const { tracks, report } = imported(SAMPLE_CRATE_CSV);
    expect(tracks).toHaveLength(80);
    expect(SAMPLE_TRACKS).toHaveLength(80);
    expect(report.layout).toBe("Generic");
    expect(report.skippedCount).toBe(0);
    expect(report.energyDerived).toBe(0);
    expect(report.durationAssumed).toBe(0);
    expect(new Set(tracks.map((track) => track.id)).size).toBe(80);
    expect(new Set(tracks.map((track) => track.title)).size).toBe(80);
    const quoted = tracks.find((track) => track.title === "Lights Out, Liberty Park");
    expect(quoted?.artist).toBe("Wren Castellan");
    for (const track of tracks) {
      expect(track.bpm).toBeGreaterThanOrEqual(98);
      expect(track.bpm).toBeLessThanOrEqual(132);
      expect(track.energy).toBeGreaterThanOrEqual(1);
      expect(track.energy).toBeLessThanOrEqual(10);
      expect(track.durationSec).toBeGreaterThan(240);
    }
  });

  it("reads a Rekordbox playlist export: tabs, UTF-16, musical keys, no energy", () => {
    const text = decodeText(
      utf16le(
        [
          "#\tArtwork\tTrack Title\tArtist\tAlbum\tGenre\tBPM\tRating\tTime\tKey\tDate Added",
          "1\t\tOpen Fader Policy\tMarlo Venn\tDemo EP\tHouse\t124.00\t*****\t06:10\tAm\t2026-01-04",
          "2\t\tBerm Shot\tKessa Lune\tDemo EP\tTech House\t128.00\t***\t05:45\tF#m\t2026-01-05",
          "3\t\tSlow Thaw\tOdd Harbor\tDemo EP\tDeep House\t120.00\t****\t07:02\tEb\t2026-01-06",
        ].join("\r\n"),
      ),
    );
    const { tracks, report } = imported(text);
    expect(report.layout).toBe("Rekordbox");
    expect(report.delimiter).toBe("\t");
    expect(tracks.map((track) => track.title)).toEqual([
      "Open Fader Policy",
      "Berm Shot",
      "Slow Thaw",
    ]);
    expect(tracks.map((track) => keyCode(track.key))).toEqual(["8A", "11A", "5B"]);
    expect(tracks[0].durationSec).toBe(370);
    expect(tracks[0].genre).toBe("House");
    // No energy column: every track gets a flagged stand-in derived from tempo.
    expect(report.energyDerived).toBe(3);
    expect(tracks.every((track) => track.energyDerived)).toBe(true);
    expect(tracks.map((track) => track.energy)).toEqual([6, 8, 3]);
  });

  it("reads a Serato-style CSV: name, length, location", () => {
    const { tracks, report } = imported(
      [
        "name,artist,bpm,key,genre,length,location",
        '"First Tracks, No Friends",Juno Halvard,123,8A,House,6:28,/Music/Juno Halvard - First Tracks.aiff',
        "Float Valve Funk,Plaid Engine,121,Bbm,Disco House,5:40,/Music/Plaid Engine - Float Valve Funk.mp3",
      ].join("\n"),
    );
    expect(report.layout).toBe("Serato");
    expect(report.hasPaths).toBe(true);
    expect(tracks[0].title).toBe("First Tracks, No Friends");
    expect(tracks[0].path).toBe("/Music/Juno Halvard - First Tracks.aiff");
    expect(keyCode(tracks[1].key)).toBe("3A");
  });

  it("reads a Traktor-style export with Open Key notation", () => {
    const { tracks, report } = imported(
      [
        "Title,Artist,Release,Genre,BPM,Key,Time",
        "A,One,R,House,124,1m,6:00",
        "B,Two,R,House,125,12d,6:30",
      ].join("\n"),
    );
    expect(report.layout).toBe("Traktor");
    expect(tracks.map((track) => keyCode(track.key))).toEqual(["8A", "7B"]);
  });

  it("reads a Mixed In Key export: title and artist come from the file name", () => {
    const { tracks, report } = imported(
      [
        "Collection name,File name,Key result,BPM,ID3 tag key,Energy",
        "Gig,Tessa Marrow - Granite Groove Works.wav,9A,126,,7",
        "Gig,Untitled Bounce.mp3,10A/11A,127,,8",
      ].join("\n"),
    );
    expect(report.layout).toBe("Mixed In Key");
    expect(tracks[0]).toMatchObject({
      title: "Granite Groove Works",
      artist: "Tessa Marrow",
      energy: 7,
      energyDerived: false,
    });
    expect(tracks[1]).toMatchObject({ title: "Untitled Bounce", artist: "" });
    expect(keyCode(tracks[1].key)).toBe("10A");
    expect(report.durationAssumed).toBe(2);
    expect(tracks[0].durationAssumed).toBe(true);
  });

  it("reads a semicolon file with decimal commas and a byte-order mark", () => {
    const { tracks, report } = imported(
      "﻿Title;Artist;Tempo;Camelot\nA;One;123,5;8A\nB;Two;125;9A",
    );
    expect(report.delimiter).toBe(";");
    expect(tracks[0].bpm).toBe(123.5);
  });

  it("skips rows it cannot use and says why", () => {
    const { tracks, report } = imported(
      [
        "Title,Artist,BPM,Key,Energy",
        "Good One,A,124,8A,6",
        ",B,124,8A,6",
        "No Tempo,C,,8A,6",
        "Odd Key,D,124,H#,6",
        "Good Two,E,125,9A,",
      ].join("\n"),
    );
    expect(tracks.map((track) => track.title)).toEqual(["Good One", "Good Two"]);
    expect(report.rows).toBe(5);
    expect(report.skippedCount).toBe(3);
    expect(report.skipped.map((entry) => entry.reason)).toEqual([
      "no title",
      'no usable BPM ("")',
      'unreadable key ("H#")',
    ]);
    expect(report.skipped[0].row).toBe(3);
    expect(report.energyDerived).toBe(1);
    expect(tracks[1].energyDerived).toBe(true);
    expect(tracks[0].energyDerived).toBe(false);
  });

  it("derives a mid-scale energy when every tempo is the same", () => {
    const { tracks } = imported("Title,BPM,Key\nA,124,8A\nB,124,9A");
    expect(tracks.map((track) => track.energy)).toEqual([5, 5]);
  });

  it("explains a file it cannot read", () => {
    expect(importCrate("")).toEqual({ ok: false, error: "That file is empty." });
    const noColumns = importCrate("Song,Singer\nA,B");
    expect(noColumns.ok).toBe(false);
    if (!noColumns.ok) expect(noColumns.error).toContain("BPM and Key");
    const noRows = importCrate("Title,BPM,Key\n");
    expect(noRows.ok).toBe(false);
    const allBad = importCrate("Title,BPM,Key\nA,,8A");
    expect(allBad.ok).toBe(false);
    if (!allBad.ok) expect(allBad.error).toContain("no usable BPM");
  });

  it(`stops at ${MAX_TRACKS} tracks and reports the cut`, () => {
    const rows = Array.from({ length: MAX_TRACKS + 25 }, (_, i) => `Track ${i},A,124,8A`);
    const { tracks, report } = imported(["Title,Artist,BPM,Key", ...rows].join("\n"));
    expect(tracks).toHaveLength(MAX_TRACKS);
    expect(report.truncated).toBe(true);
  });
});
