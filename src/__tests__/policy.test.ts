import { describe, it, expect } from "vitest";
import { parsePolicy } from "../core/policy.js";

describe("parsePolicy", () => {
  it("Required Slots 섹션을 읽어 role->slots 매핑", () => {
    const p = parsePolicy(`## Required Slots
- \`feature\`: [acceptance_criteria, priority]
- \`data-entity\`: [fields]`);
    expect(p.requiredSlots.feature).toEqual(["acceptance_criteria", "priority"]);
    expect(p.requiredSlots["data-entity"]).toEqual(["fields"]);
  });

  it("Terminology Rules 를 키→값 매핑으로", () => {
    const p = parsePolicy(`## Terminology Rules
- \`화이트보드\` -> \`Whiteboard GUI\``);
    expect(p.terminologyRules["화이트보드"]).toBe("Whiteboard GUI");
  });

  it("Blast Radius 임계값 파싱", () => {
    const p = parsePolicy(`## Blast Radius
- critical: 5
- warning: 2`);
    expect(p.blastRadiusThresholds.critical).toBe(5);
    expect(p.blastRadiusThresholds.warning).toBe(2);
  });

  it("Trackable Attributes 누적", () => {
    const p = parsePolicy(`## Trackable Attributes
- \`title\`
- \`attrs.fields\``);
    expect(p.trackableAttributes).toContain("title");
    expect(p.trackableAttributes).toContain("attrs.fields");
  });
});
