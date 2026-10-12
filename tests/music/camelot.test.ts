import { describe, expect, it } from "vitest";
import {
  camelotKey,
  compatibleKeys,
  keyCode,
  keyFromIndex,
  keyIndex,
  keyMove,
  keyName,
  openKeyCode,
  parseKey,
  wheelSteps,
} from "@/lib/music/camelot";

const code = (text: string) => {
  const key = parseKey(text);
  return key ? keyCode(key) : null;
};

describe("parseKey", () => {
  it("reads Camelot codes, with any case, padding, or spacing", () => {
    expect(code("8A")).toBe("8A");
    expect(code("8a")).toBe("8A");
    expect(code("08B")).toBe("8B");
    expect(code(" 12 b ")).toBe("12B");
    expect(code("1A")).toBe("1A");
  });

  it("reads Open Key codes (Traktor): 1m is A minor, 1d is C major", () => {
    expect(code("1m")).toBe("8A");
    expect(code("1d")).toBe("8B");
    expect(code("6m")).toBe("1A");
    expect(code("12d")).toBe("7B");
    expect(code("7D")).toBe("2B");
  });

  it("reads musical names for all 24 keys", () => {
    const majors = ["B", "F#", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E"];
    const minors = ["Abm", "Ebm", "Bbm", "Fm", "Cm", "Gm", "Dm", "Am", "Em", "Bm", "F#m", "Dbm"];
    majors.forEach((name, i) => expect(code(name)).toBe(`${i + 1}B`));
    minors.forEach((name, i) => expect(code(name)).toBe(`${i + 1}A`));
  });

  it("treats sharps and flats that name the same pitch as the same key", () => {
    expect(code("G#m")).toBe(code("Abm"));
    expect(code("C#")).toBe(code("Db"));
    expect(code("A#m")).toBe(code("Bbm"));
    expect(code("D♯m")).toBe(code("E♭m"));
    expect(code("Gb")).toBe(code("F#"));
    expect(code("Cb")).toBe(code("B"));
  });

  it("reads long spellings and symbols", () => {
    expect(code("A minor")).toBe("8A");
    expect(code("c major")).toBe("8B");
    expect(code("F# min")).toBe("11A");
    expect(code("Bbmaj")).toBe("6B");
    expect(code("E flat minor")).toBe("2A");
    expect(code("F sharp")).toBe("2B");
    expect(code("AM")).toBe("11B");
    expect(code("A-")).toBe("8A");
  });

  it("takes the first readable key from a cell with two spellings", () => {
    expect(code("F#m/Gbm")).toBe("11A");
    expect(code("8A - Am")).toBe("8A");
    expect(code("10A/11A")).toBe("10A");
  });

  it("rejects text that is not a key", () => {
    for (const text of ["", "  ", "13A", "0B", "H", "Deep House", "Am7", "8C", "none"]) {
      expect(parseKey(text)).toBeNull();
    }
  });
});

describe("key names", () => {
  it("round-trips every key through its Camelot, Open Key, and musical names", () => {
    for (let index = 0; index < 24; index++) {
      const key = keyFromIndex(index);
      expect(keyIndex(key)).toBe(index);
      expect(parseKey(keyCode(key))).toEqual(key);
      expect(parseKey(openKeyCode(key))).toEqual(key);
      expect(parseKey(keyName(key))).toEqual(key);
    }
  });

  it("names relative keys on the same wheel position", () => {
    expect(keyName(camelotKey(8, "A"))).toBe("Am");
    expect(keyName(camelotKey(8, "B"))).toBe("C");
    expect(openKeyCode(camelotKey(8, "A"))).toBe("1m");
    expect(openKeyCode(camelotKey(7, "B"))).toBe("12d");
  });
});

describe("keyMove", () => {
  const move = (from: string, to: string) => keyMove(parseKey(from)!, parseKey(to)!);

  it("classifies the four compatible moves", () => {
    expect(move("8A", "8A").relation).toBe("same");
    expect(move("8A", "9A").relation).toBe("adjacent");
    expect(move("8A", "7A").relation).toBe("adjacent");
    expect(move("8A", "8B").relation).toBe("relative");
    expect(move("8B", "8A").relation).toBe("relative");
    expect(move("8A", "10A").relation).toBe("boost");
  });

  it("wraps round the top of the wheel: 12 and 1 are neighbours", () => {
    expect(wheelSteps(12, 1)).toBe(1);
    expect(wheelSteps(1, 12)).toBe(-1);
    expect(move("12A", "1A").relation).toBe("adjacent");
    expect(move("1B", "12B").relation).toBe("adjacent");
    expect(move("11A", "1A").relation).toBe("boost");
    expect(move("12B", "2B").relation).toBe("boost");
    expect(wheelSteps(1, 7)).toBe(6);
    expect(wheelSteps(7, 1)).toBe(6);
  });

  it("treats +2 as a boost but -2 as a clash", () => {
    expect(move("8A", "10A").relation).toBe("boost");
    expect(move("10A", "8A").relation).toBe("clash");
    expect(move("1A", "11A").relation).toBe("clash");
  });

  it("treats a ring change combined with a step as a clash", () => {
    expect(move("8A", "9B").relation).toBe("clash");
    expect(move("8A", "10B").relation).toBe("clash");
  });

  it("orders costs: same < adjacent < relative < boost < every clash", () => {
    const same = move("8A", "8A").cost;
    const adjacent = move("8A", "9A").cost;
    const relative = move("8A", "8B").cost;
    const boost = move("8A", "10A").cost;
    expect(same).toBe(0);
    expect(adjacent).toBeGreaterThan(same);
    expect(relative).toBeGreaterThan(adjacent);
    expect(boost).toBeGreaterThan(relative);
    for (let index = 0; index < 24; index++) {
      const result = keyMove(camelotKey(8, "A"), keyFromIndex(index));
      if (result.relation === "clash") expect(result.cost).toBeGreaterThan(boost);
      expect(result.cost).toBeLessThanOrEqual(1);
    }
  });

  it("grades clashes: further round the wheel costs more", () => {
    const costs = [3, 4, 5, 6].map((steps) => move("1A", `${1 + steps}A`).cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(new Set(costs).size).toBe(4);
    expect(move("1A", "7A").cost).toBe(1);
    expect(move("8A", "9B").cost).toBeLessThan(move("8A", "11B").cost);
  });

  it("labels moves for the badges", () => {
    expect(move("8A", "8A").label).toBe("Same key");
    expect(move("8A", "9A").label).toBe("+1 on the wheel");
    expect(move("8A", "7A").label).toBe("-1 on the wheel");
    expect(move("8A", "8B").label).toBe("Relative major");
    expect(move("8B", "8A").label).toBe("Relative minor");
    expect(move("8A", "10A").label).toBe("Energy boost +2");
    expect(move("8A", "9B").label).toBe("Diagonal clash");
    expect(move("8A", "12A").label).toBe("Clash, 4 steps");
  });
});

describe("compatibleKeys", () => {
  it("lists exactly the keys keyMove calls compatible", () => {
    for (let index = 0; index < 24; index++) {
      const from = keyFromIndex(index);
      const listed = new Map(
        compatibleKeys(from).map((entry) => [keyCode(entry.key), entry.relation]),
      );
      for (let other = 0; other < 24; other++) {
        const to = keyFromIndex(other);
        const relation = keyMove(from, to).relation;
        if (relation === "clash") expect(listed.has(keyCode(to))).toBe(false);
        else expect(listed.get(keyCode(to))).toBe(relation);
      }
      expect(listed.size).toBe(5);
    }
  });
});
