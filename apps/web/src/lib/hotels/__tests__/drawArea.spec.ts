import { describe, expect, it } from "vitest";
import { encodeArea, inArea, isSimpleRing, parseArea, rectangleRing, MAX_VERTICES, type Ring } from "../drawArea";

const square: Ring = [[139.7, 35.6], [139.8, 35.6], [139.8, 35.7], [139.7, 35.7]];

describe("parseArea", () => {
  it("round-trips a valid polygon", () => {
    expect(parseArea(encodeArea(square))).toEqual(square);
  });
  it("accepts an explicitly closed ring", () => {
    expect(parseArea(encodeArea([...square, square[0]]))).toEqual(square);
  });
  it("rejects too few or too many vertices", () => {
    expect(parseArea("139.7,35.6;139.8,35.6")).toBeNull();
    const many = Array.from({ length: MAX_VERTICES + 1 }, (_, i) => {
      const a = (i / (MAX_VERTICES + 1)) * 2 * Math.PI;
      return `${(139.7 + 0.1 * Math.cos(a)).toFixed(5)},${(35.6 + 0.1 * Math.sin(a)).toFixed(5)}`;
    }).join(";");
    expect(parseArea(many)).toBeNull();
  });
  it("rejects malformed, out-of-range, oversized and degenerate shapes", () => {
    expect(parseArea("a,b;c,d;e,f")).toBeNull();
    expect(parseArea("139.7,35.6;139.8;139.8,35.7")).toBeNull();
    expect(parseArea("200,35.6;139.8,35.6;139.8,35.7")).toBeNull();
    expect(parseArea("130,30;140,30;140,40")).toBeNull(); // 10° span
    expect(parseArea("139.7,35.6;139.7,35.6;139.7,35.6")).toBeNull();
    expect(parseArea("x".repeat(5000))).toBeNull();
    expect(parseArea(null)).toBeNull();
  });
  it("rejects a self-intersecting (bow-tie) ring", () => {
    const bowtie: Ring = [[139.7, 35.6], [139.8, 35.7], [139.8, 35.6], [139.7, 35.7]];
    expect(isSimpleRing(bowtie)).toBe(false);
    expect(parseArea(encodeArea(bowtie))).toBeNull();
  });
});

describe("inArea", () => {
  it("includes inside points and excludes outside ones", () => {
    expect(inArea({ latitude: 35.65, longitude: 139.75 }, square)).toBe(true);
    expect(inArea({ latitude: 35.75, longitude: 139.75 }, square)).toBe(false);
    expect(inArea({ latitude: NaN, longitude: 139.75 }, square)).toBe(false);
  });
  it("handles a concave shape", () => {
    // An L: the notch at the top-right is outside.
    const L: Ring = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
    expect(inArea({ latitude: 0.5, longitude: 1.5 }, L)).toBe(true);
    expect(inArea({ latitude: 1.5, longitude: 1.5 }, L)).toBe(false);
  });
});

describe("rectangleRing", () => {
  it("normalises two corners in any order", () => {
    const r = rectangleRing({ latitude: 35.7, longitude: 139.8 }, { latitude: 35.6, longitude: 139.7 });
    expect(r).toEqual(square);
  });
});
