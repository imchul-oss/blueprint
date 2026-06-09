import { describe, it, expect } from "vitest";
import { blastRadius } from "../core/impact.js";
import type { Blueprint } from "../core/types.js";

const bp: Blueprint = {
  meta: { id: "t", title: "t", version: "0.1", rev: 1 },
  nodes: [
    { id: "n_root", role: "product", title: "root", status: "confirmed" },
    { id: "n_a", role: "feature", title: "A", status: "confirmed" },
    { id: "n_b", role: "feature", title: "B", status: "confirmed" },
    { id: "n_c", role: "feature", title: "C", status: "confirmed" },
    { id: "n_g", role: "goal", title: "G", status: "confirmed" },
    { id: "n_m", role: "metric", title: "M", status: "confirmed" },
  ],
  edges: [
    { from: "n_a", to: "n_root", type: "parent" },
    { from: "n_b", to: "n_root", type: "parent" },
    { from: "n_c", to: "n_root", type: "parent" },
    { from: "n_g", to: "n_root", type: "parent" },
    { from: "n_m", to: "n_root", type: "parent" },
    { from: "n_b", to: "n_a", type: "depends-on" }, // B depends on A
    { from: "n_c", to: "n_b", type: "depends-on" }, // C depends on B
    { from: "n_m", to: "n_g", type: "supports" }, // M supports G
  ],
};

describe("blastRadius", () => {
  it("depends-on: 피의존(A) 변경 시 의존자(B)로 전파", () => {
    const r = blastRadius(bp, ["n_a"]);
    expect(r.affected).toContain("n_b");
    expect(r.affected).toContain("n_c"); // 전이적
  });

  it("supports: claim/metric 변경 시 목표로 전파", () => {
    const r = blastRadius(bp, ["n_m"]);
    expect(r.affected).toContain("n_g");
  });

  it("등급화: 파급 0~1 → 국소", () => {
    const isolated: Blueprint = {
      meta: { id: "t", title: "t", version: "0.1", rev: 1 },
      nodes: [
        { id: "a", role: "feature", title: "a", status: "draft" },
        { id: "b", role: "feature", title: "b", status: "draft" },
      ],
      edges: [{ from: "a", to: "b", type: "depends-on" }],
    };
    const r = blastRadius(isolated, ["b"]);
    expect(r.level).toBe("국소");
  });
});
