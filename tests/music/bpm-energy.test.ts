import { describe, expect, it } from "vitest";
import { formatPct, tempoMove } from "@/lib/music/bpm";
import { DEFAULT_ARC, energyAt, fromLevel, normalizeArc, toLevel } from "@/lib/music/energy";
import { parseKey } from "@/lib/music/camelot";
import { formatEnergyChange, transitionFacts } from "@/lib/music/transition";

describe("tempoMove", () => {
  it("measures how much faster or slower the incoming track is", () => {
    const up = tempoMove(124, 126);
    expect(up.pct).toBeCloseTo(1.613, 3);
    expect(up.match).toBe("straight");
    expect(up.inRange).toBe(true);
    expect(tempoMove(126, 124).pct).toBeCloseTo(-1.587, 3);
    expect(tempoMove(124, 124).cost).toBe(0);
  });

  it("costs tempo linearly up to the 6% pitch range", () => {
    expect(tempoMove(100, 103).cost).toBeCloseTo(0.5, 6);
    expect(tempoMove(100, 106).cost).toBeCloseTo(1, 6);
    expect(tempoMove(100, 106).inRange).toBe(true);
  });

  it("penalises anything past 6% far more than anything inside it", () => {
    const edge = tempoMove(100, 106);
    const past = tempoMove(100, 107);
    expect(past.inRange).toBe(false);
    expect(past.cost).toBeGreaterThanOrEqual(2);
    expect(past.cost).toBeGreaterThan(edge.cost * 2);
    expect(tempoMove(100, 115).cost).toBeGreaterThan(past.cost);
    expect(tempoMove(100, 160).cost).toBeLessThan(5.2);
  });

  it("recognises half-time and double-time matches", () => {
    const half = tempoMove(174, 87);
    expect(half.match).toBe("half");
    expect(half.pct).toBeCloseTo(0, 6);
    expect(half.inRange).toBe(true);
    const double = tempoMove(87, 174);
    expect(double.match).toBe("double");
    expect(double.pct).toBeCloseTo(0, 6);
    const near = tempoMove(172, 88);
    expect(near.match).toBe("half");
    expect(near.pct).toBeCloseTo(2.326, 3);
  });

  it("charges a small surcharge for a half or double-time mix", () => {
    expect(tempoMove(174, 87).cost).toBeGreaterThan(tempoMove(174, 174).cost);
    expect(tempoMove(174, 87).cost).toBeLessThan(tempoMove(174, 180).cost);
  });

  it("formats percentages for badges", () => {
    expect(formatPct(1.613)).toBe("+1.6%");
    expect(formatPct(-0.84)).toBe("-0.8%");
    expect(formatPct(0.02)).toBe("0%");
    expect(formatPct(-0.04)).toBe("0%");
  });
});

describe("energy arc", () => {
  it("maps between normalised energy and the 1-10 scale", () => {
    expect(toLevel(0)).toBe(1);
    expect(toLevel(1)).toBe(10);
    expect(fromLevel(5.5)).toBeCloseTo(0.5, 9);
  });

  it("interpolates between points and stays flat beyond the ends", () => {
    const arc = [
      { t: 0.2, e: 0.2 },
      { t: 0.6, e: 1 },
    ];
    expect(energyAt(arc, 0)).toBe(0.2);
    expect(energyAt(arc, 0.4)).toBeCloseTo(0.6, 9);
    expect(energyAt(arc, 0.6)).toBe(1);
    expect(energyAt(arc, 0.9)).toBe(1);
    expect(energyAt([], 0.5)).toBe(0.5);
  });

  it("cleans raw points: clamps, sorts, merges duplicates, extends to both ends", () => {
    const arc = normalizeArc([
      { t: 0.5, e: 1.4 },
      { t: 0.1, e: -0.2 },
      { t: 0.5, e: 0.9 },
      { t: Number.NaN, e: 0.5 },
      { t: 0.8, e: "high" },
      { t: 0.9, e: 0.4 },
    ]);
    expect(arc).toEqual([
      { t: 0, e: 0 },
      { t: 0.1, e: 0 },
      { t: 0.5, e: 0.9 },
      { t: 0.9, e: 0.4 },
      { t: 1, e: 0.4 },
    ]);
    // A point that is nearly at an end is snapped instead of duplicated.
    expect(
      normalizeArc([
        { t: 0.01, e: 0.2 },
        { t: 0.99, e: 0.8 },
      ]),
    ).toEqual([
      { t: 0, e: 0.2 },
      { t: 1, e: 0.8 },
    ]);
  });

  it("rejects input with fewer than two usable points", () => {
    expect(normalizeArc([])).toBeNull();
    expect(normalizeArc([{ t: 0.5, e: 0.5 }])).toBeNull();
    expect(
      normalizeArc([
        { t: 0.5, e: 0.5 },
        { t: 0.5, e: 0.7 },
      ]),
    ).toBeNull();
  });

  it("thins a long list to at most 32 points and keeps both ends", () => {
    const raw = Array.from({ length: 200 }, (_, i) => ({ t: i / 199, e: (i % 10) / 10 }));
    const arc = normalizeArc(raw)!;
    expect(arc).toHaveLength(32);
    expect(arc[0].t).toBe(0);
    expect(arc[31].t).toBe(1);
    for (let i = 1; i < arc.length; i++) expect(arc[i].t).toBeGreaterThan(arc[i - 1].t);
  });

  it("ships a default arc that is already valid", () => {
    expect(normalizeArc(DEFAULT_ARC)).toEqual(DEFAULT_ARC);
  });
});

describe("transitionFacts", () => {
  const track = (key: string, bpm: number, energy: number) => ({
    key: parseKey(key)!,
    bpm,
    energy,
  });

  it("combines key, tempo, and energy into one record", () => {
    const facts = transitionFacts(track("8A", 124, 5), track("9A", 126, 7));
    expect(facts.key.relation).toBe("adjacent");
    expect(facts.tempo.pct).toBeCloseTo(1.613, 3);
    expect(facts.energyChange).toBe(2);
    expect(facts.clean).toBe(true);
  });

  it("is not clean when the key clashes or the tempo is out of range", () => {
    expect(transitionFacts(track("8A", 124, 5), track("2A", 124, 5)).clean).toBe(false);
    expect(transitionFacts(track("8A", 110, 5), track("8A", 128, 5)).clean).toBe(false);
  });

  it("formats energy changes with a sign", () => {
    expect(formatEnergyChange(2)).toBe("+2");
    expect(formatEnergyChange(-1)).toBe("-1");
    expect(formatEnergyChange(0)).toBe("0");
  });
});
