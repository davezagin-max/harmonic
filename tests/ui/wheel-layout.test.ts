import { describe, expect, it } from "vitest";
import { SAMPLE_TRACKS } from "@/lib/crate/sample";
import type { Track } from "@/lib/crate/types";
import { defaultRun } from "@/lib/defaults";
import { keyFromIndex, keyIndex, parseKey } from "@/lib/music/camelot";
import { keyHue } from "@/lib/ui/colors";
import {
  labelPoint,
  layoutWheel,
  linkPath,
  positionAngle,
  segmentPath,
  WHEEL,
} from "@/lib/ui/wheel-layout";

const setIds = defaultRun().order.map((index) => SAMPLE_TRACKS[index].id);
const layout = layoutWheel(SAMPLE_TRACKS, setIds);

function polarOf(point: { x: number; y: number }) {
  const dx = point.x - WHEEL.center;
  const dy = point.y - WHEEL.center;
  return { radius: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
}

function angleGap(a: number, b: number): number {
  const gap = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(gap, 2 * Math.PI - gap);
}

describe("wheel geometry", () => {
  it("puts 12 at the top and runs clockwise like a clock", () => {
    expect(positionAngle(12)).toBeCloseTo(-Math.PI / 2, 9);
    expect(positionAngle(3)).toBeCloseTo(0, 9);
    expect(positionAngle(6)).toBeCloseTo(Math.PI / 2, 9);
    const top = labelPoint({ n: 12, ring: "B" });
    expect(top.x).toBeCloseTo(WHEEL.center, 6);
    expect(top.y).toBeLessThan(WHEEL.center);
  });

  it("gives each wheel position its own hue, 30 degrees apart", () => {
    const hues = Array.from({ length: 12 }, (_, i) => keyHue(i + 1));
    expect(new Set(hues).size).toBe(12);
    for (const hue of hues) {
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      expect(hue % 30).toBe(0);
    }
  });

  it("draws closed segment paths and curved links", () => {
    for (let index = 0; index < 24; index++) {
      expect(segmentPath(keyFromIndex(index))).toMatch(/^M[\d. -]+A[\d. -]+L[\d. -]+A[\d. -]+Z$/);
    }
    expect(linkPath({ x: 100, y: 100 }, { x: 500, y: 480 })).toMatch(/^M100\.00 100\.00Q/);
    // Coincident points must not produce NaN.
    expect(linkPath({ x: 100, y: 100 }, { x: 100, y: 100 })).not.toContain("NaN");
  });
});

describe("layoutWheel on the sample crate", () => {
  it("accounts for every track: drawn, or counted as overflow", () => {
    const overflow = [...layout.overflow.values()].reduce((sum, count) => sum + count, 0);
    expect(layout.nodes.size + overflow).toBe(SAMPLE_TRACKS.length);
    // The sample crate is small enough that nothing is hidden.
    expect(overflow).toBe(0);
  });

  it("always draws the set, with its play order", () => {
    setIds.forEach((id, index) => {
      expect(layout.nodes.get(id)?.position).toBe(index + 1);
    });
    const others = [...layout.nodes.values()].filter((node) => node.position === null);
    expect(others).toHaveLength(SAMPLE_TRACKS.length - setIds.length);
  });

  it("keeps every node inside its own key's segment", () => {
    for (const track of SAMPLE_TRACKS) {
      const node = layout.nodes.get(track.id);
      if (!node) continue;
      const { radius, angle } = polarOf(node);
      expect(angleGap(angle, positionAngle(track.key.n))).toBeLessThan(Math.PI / 12);
      if (track.key.ring === "A") {
        expect(radius).toBeGreaterThan(WHEEL.innerEdge);
        expect(radius).toBeLessThan(WHEEL.split);
      } else {
        expect(radius).toBeGreaterThan(WHEEL.split);
        expect(radius).toBeLessThan(WHEEL.outerEdge);
      }
    }
  });

  it("does not stack numbered set nodes on top of each other", () => {
    const nodes = setIds.map((id) => layout.nodes.get(id)!);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        expect(Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)).toBeGreaterThan(21);
      }
    }
  });
});

describe("layoutWheel on a crowded key", () => {
  const crowd: Track[] = Array.from({ length: 60 }, (_, i) => ({
    id: `c${i}`,
    title: `Track ${i}`,
    artist: "",
    bpm: 124,
    key: parseKey("8A")!,
    energy: 5,
    energyDerived: false,
    genre: "",
    durationSec: 360,
    durationAssumed: false,
    path: null,
  }));

  it("counts what it cannot fit instead of drawing dots on top of each other", () => {
    const crowded = layoutWheel(crowd, ["c0", "c1", "c2"]);
    const hidden = crowded.overflow.get(keyIndex(parseKey("8A")!)) ?? 0;
    expect(hidden).toBeGreaterThan(0);
    expect(crowded.nodes.size + hidden).toBe(60);
    for (const id of ["c0", "c1", "c2"]) expect(crowded.nodes.get(id)?.position).not.toBeNull();
  });
});
