import { describe, expect, it } from "vitest";
import type { Point } from "@wf/schema";
import {
  apply, area, centroid, compose, fitSimilarity, invert, pointAlong, pointInPolygon, polylineLength, toLatLon, toLocal,
} from "./index";

const close = (a: Point, b: Point, eps = 1e-9) => {
  expect(a[0]).toBeCloseTo(b[0], -Math.log10(eps));
  expect(a[1]).toBeCloseTo(b[1], -Math.log10(eps));
};

describe("similarity", () => {
  const t = { scale: 0.025, rotation: 0.3, tx: -12, ty: 40 };

  it("inverts", () => {
    const p: Point = [1234, 567];
    close(apply(invert(t), apply(t, p)), p, 1e-6);
  });

  it("composes in order", () => {
    const u = { scale: 2, rotation: -1, tx: 3, ty: 4 };
    const p: Point = [5, -7];
    close(apply(compose(t, u), p), apply(u, apply(t, p)), 1e-6);
  });

  it("recovers a known transform exactly", () => {
    const src: Point[] = [[0, 0], [3000, 0], [3000, 2000], [100, 1500]];
    const fit = fitSimilarity(src, src.map((p) => apply(t, p)));
    expect(fit.transform.scale).toBeCloseTo(t.scale, 9);
    expect(fit.transform.rotation).toBeCloseTo(t.rotation, 9);
    expect(fit.rms).toBeLessThan(1e-9);
  });

  it("works with 2 pairs and reports residuals with noise", () => {
    expect(fitSimilarity([[0, 0], [10, 0]], [[5, 5], [5, 25]]).transform.scale).toBeCloseTo(2);
    const src: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const dst = src.map((p, i) => apply(t, p).map((v) => v + (i % 2 ? 0.01 : -0.01)) as Point);
    const fit = fitSimilarity(src, dst);
    expect(fit.rms).toBeGreaterThan(0);
    expect(fit.residuals).toHaveLength(4);
  });

  it("rejects degenerate input", () => {
    expect(() => fitSimilarity([[1, 1]], [[2, 2]])).toThrow();
    expect(() => fitSimilarity([[1, 1], [1, 1]], [[0, 0], [1, 1]])).toThrow();
  });
});

describe("polygon", () => {
  const sq: Point[] = [[0, 0], [4, 0], [4, 2], [0, 2]];
  it("area/centroid/containment", () => {
    expect(area(sq)).toBe(8);
    close(centroid(sq), [2, 1]);
    expect(pointInPolygon([1, 1], sq)).toBe(true);
    expect(pointInPolygon([5, 1], sq)).toBe(false);
  });
  it("walks polylines", () => {
    const line: Point[] = [[0, 0], [10, 0], [10, 10]];
    expect(polylineLength(line)).toBe(20);
    close(pointAlong(line, 0.75), [10, 5]);
    close(pointAlong(line, 2), [10, 10]);
  });
});

describe("geo", () => {
  it("round-trips near Wheeler Hall", () => {
    const origin = { lat: 37.8713, lon: -122.2591 };
    const p = toLocal(origin, { lat: 37.8716, lon: -122.2587 });
    expect(p[0]).toBeGreaterThan(30);
    expect(p[1]).toBeGreaterThan(30);
    const back = toLatLon(origin, p);
    expect(back.lat).toBeCloseTo(37.8716, 9);
    expect(back.lon).toBeCloseTo(-122.2587, 9);
  });
});

describe("image <-> world", () => {
  it("chains level -> reference -> world through the y flip", async () => {
    const { levelImageTransform, imageToWorld, worldToImage } = await import("./index");
    const toRef = { scale: 1.1, rotation: Math.PI / 2, tx: 40, ty: -15 };
    const refToWorld = { scale: 0.02, rotation: 0.4, tx: -30, ty: 12 };
    const p: Point = [812, 455];
    const viaRef = apply(toRef, p);
    const expected = apply(refToWorld, [viaRef[0], -viaRef[1]]);
    const t = levelImageTransform(toRef, refToWorld);
    close(imageToWorld(t, p), expected, 1e-6);
    close(worldToImage(t, expected), p, 1e-6);
  });
});

describe("interior point and oriented extent", () => {
  /** A C-shape: the area centroid falls in the notch, outside the polygon. */
  const cShape: Point[] = [
    [0, 0],
    [10, 0],
    [10, 3],
    [3, 3],
    [3, 7],
    [10, 7],
    [10, 10],
    [0, 10],
  ];

  it("falls back to a point inside when the centroid is outside", async () => {
    const { centroid, interiorPoint, pointInPolygon } = await import("./index");
    expect(pointInPolygon(centroid(cShape), cShape)).toBe(false);
    const p = interiorPoint(cShape);
    expect(pointInPolygon(p, cShape)).toBe(true);
    // The widest part of a C is its spine, not the arms.
    expect(p[0]).toBeLessThan(3);
  });

  it("uses the centroid when that is already inside", async () => {
    const { centroid, interiorPoint } = await import("./index");
    const square: Point[] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    close(interiorPoint(square), centroid(square), 1e-9);
  });

  it("measures a rotated box along its own axis", async () => {
    const { orientedExtent } = await import("./index");
    const angle = Math.PI / 6;
    const box: Point[] = [
      [0, 0],
      [8, 0],
      [8, 2],
      [0, 2],
    ].map(([x, y]) => [x! * Math.cos(angle) - y! * Math.sin(angle), x! * Math.sin(angle) + y! * Math.cos(angle)] as Point);
    const e = orientedExtent(box, angle);
    expect(e.along).toBeCloseTo(8, 6);
    expect(e.across).toBeCloseTo(2, 6);
  });
});
