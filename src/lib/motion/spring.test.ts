import { describe, expect, it } from "vitest";
import { project, rubberband, stepSpring, velocityFrom } from "./spring";

const simulate = (config: { damping: number; response: number }, seconds = 2, from = 100) => {
  let s = { value: from, velocity: 0 };
  let min = Infinity;
  for (let t = 0; t < seconds; t += 1 / 60) {
    s = stepSpring(s, 0, config, 1 / 60);
    min = Math.min(min, s.value);
  }
  return { end: s, min };
};

describe("ressorts", () => {
  it("amortissement critique : atteint la cible sans la dépasser", () => {
    const { end, min } = simulate({ damping: 1, response: 0.35 });
    expect(Math.abs(end.value)).toBeLessThan(0.01);
    expect(min).toBeGreaterThan(-0.01);
  });
  it("amortissement 0,8 : léger dépassement (rebond)", () => {
    const { end, min } = simulate({ damping: 0.8, response: 0.3 });
    expect(min).toBeLessThan(-0.5);
    expect(Math.abs(end.value)).toBeLessThan(0.01);
  });
  it("response plus faible = plus rapide", () => {
    const fast = stepSpring({ value: 100, velocity: 0 }, 0, { damping: 1, response: 0.2 }, 0.1).value;
    const slow = stepSpring({ value: 100, velocity: 0 }, 0, { damping: 1, response: 0.5 }, 0.1).value;
    expect(fast).toBeLessThan(slow);
  });
  it("reprend la vitesse transmise (pas de rupture au lâcher)", () => {
    const s = stepSpring({ value: 0, velocity: 1000 }, 0, { damping: 1, response: 0.35 }, 1 / 120);
    expect(s.value).toBeGreaterThan(0);
  });
});

describe("gestes", () => {
  it("projection de l'élan (formule d'Apple)", () => {
    expect(project(1000)).toBeCloseTo(499, 0);
    expect(project(-1000, 0.99)).toBeCloseTo(-99, 0);
  });
  it("résistance élastique : suit presque au début, de moins en moins ensuite", () => {
    expect(rubberband(10, 800)).toBeGreaterThan(5);
    expect(rubberband(400, 800)).toBeLessThan(200);
    expect(rubberband(-400, 800)).toBeCloseTo(-rubberband(400, 800));
  });
  it("vitesse calculée sur les 100 dernières ms", () => {
    expect(velocityFrom([{ t: 0, v: 0 }, { t: 900, v: 0 }, { t: 950, v: 25 }, { t: 1000, v: 50 }])).toBeCloseTo(500);
  });
});
