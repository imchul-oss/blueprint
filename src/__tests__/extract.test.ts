import { describe, it, expect } from "vitest";
import { extractBlueprintFromText } from "../core/extract.js";

describe("extractBlueprintFromText", () => {
  it("헤딩 계층이 parent 엣지로 변환된다", () => {
    const r = extractBlueprintFromText(`# 제품
## 기능명세
### 회원 영역`);
    // 헤딩만 → 3개 노드 (+root)
    expect(r.nodes.length).toBeGreaterThanOrEqual(3);
    expect(r.edges.some((e) => e.type === "parent")).toBe(true);
  });

  it("[Feature] 브래킷이 role 을 결정한다", () => {
    const r = extractBlueprintFromText(`# 제품
- [Feature] 로그인: 구글/카카오`);
    const feat = r.nodes.find((n) => n.role === "feature");
    expect(feat).toBeDefined();
    expect(feat!.attrs?.acceptance_criteria).toContain("구글");
  });

  it("data-entity 의 fields 는 콤마 분리된 배열로 들어간다", () => {
    const r = extractBlueprintFromText(`# 제품
- [entity] User: id, email, createdAt`);
    const ent = r.nodes.find((n) => n.role === "data-entity");
    expect(ent).toBeDefined();
    expect(Array.isArray(ent!.attrs?.fields)).toBe(true);
    expect((ent!.attrs!.fields as string[]).length).toBe(3);
  });
});
