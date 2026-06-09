import { describe, it, expect } from "vitest";
import { detectMissing } from "../core/missing.js";
import type { Blueprint } from "../core/types.js";

describe("detectMissing", () => {
  it("feature 에 acceptance_criteria/priority 둘 다 비면 모두 보고", () => {
    const bp: Blueprint = {
      meta: { id: "t", title: "t", version: "0.1", rev: 1 },
      nodes: [{ id: "n_f", role: "feature", title: "F", status: "draft" }],
      edges: [],
    };
    const r = detectMissing(bp);
    expect(r).toHaveLength(1);
    expect(r[0].slots).toContain("acceptance_criteria");
    expect(r[0].slots).toContain("priority");
  });

  it("data-entity 의 fields 가 없으면 보고", () => {
    const bp: Blueprint = {
      meta: { id: "t", title: "t", version: "0.1", rev: 1 },
      nodes: [{ id: "n_e", role: "data-entity", title: "User", status: "draft" }],
      edges: [],
    };
    const r = detectMissing(bp);
    expect(r[0].slots).toContain("fields");
  });

  it("claim 은 supports 엣지가 1개 이상 있어야 통과", () => {
    const bp1: Blueprint = {
      meta: { id: "t", title: "t", version: "0.1", rev: 1 },
      nodes: [
        { id: "c", role: "claim", title: "주장", status: "draft" },
        { id: "g", role: "goal", title: "G", status: "draft" },
      ],
      edges: [],
    };
    expect(detectMissing(bp1)[0].slots).toContain("supports-edge>=1");

    const bp2: Blueprint = {
      ...bp1,
      edges: [{ from: "c", to: "g", type: "supports" }],
    };
    expect(detectMissing(bp2)).toEqual([]);
  });

  it("필수 슬롯이 다 채워지면 결과는 빈 배열", () => {
    const bp: Blueprint = {
      meta: { id: "t", title: "t", version: "0.1", rev: 1 },
      nodes: [{ id: "n_f", role: "feature", title: "F", status: "draft", priority: "P0", attrs: { acceptance_criteria: "AC" } }],
      edges: [],
    };
    expect(detectMissing(bp)).toEqual([]);
  });
});
