import { describe, it, expect } from "vitest";
import { computeCompliance } from "../core/compliance.js";
import type { AuditEntry } from "../store.js";

const baseTs = 1_700_000_000_000;
const e = (over: Partial<AuditEntry>): AuditEntry => ({
  ts: baseTs,
  actor: "user",
  kind: "confirm",
  ...over,
}) as AuditEntry;

describe("computeCompliance", () => {
  it("anchor 매칭: 기존 노드 update 는 매칭, 신규 add_node 는 분모 제외", () => {
    const audit: AuditEntry[] = [
      e({ kind: "confirm", ops: [{ op: "add_node", node: { id: "n_a", role: "feature", title: "A", status: "draft" } }] }),
      e({ ts: baseTs + 1000, ops: [{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }] }),
      e({ ts: baseTs + 2000, ops: [{ op: "update_node", id: "n_ghost", patch: { status: "confirmed" } }] }), // 알려지지 않은 anchor
    ];
    const s = computeCompliance(audit);
    expect(s.anchorCountableOps).toBe(2);
    expect(s.anchorMatchedOps).toBe(1);
    expect(s.matchRate).toBeCloseTo(0.5);
  });

  it("수동보정율: confirm 직후 windowMs 안에 같은 노드 patch 가 들어오면 카운트", () => {
    const audit: AuditEntry[] = [
      e({ ts: baseTs, ops: [{ op: "add_node", node: { id: "n_a", role: "feature", title: "A", status: "draft" } }] }),
      e({ ts: baseTs + 30_000, ops: [{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }] }),
    ];
    const s = computeCompliance(audit, 60_000);
    expect(s.followUpPatchedConfirms).toBe(1);
    expect(s.manualPatchRate).toBeCloseTo(0.5); // 2 confirm 중 1건이 보정
  });

  it("audit 가 비면 비-NaN 디폴트 반환", () => {
    const s = computeCompliance([]);
    expect(Number.isNaN(s.matchRate)).toBe(true);
    expect(s.manualPatchRate).toBe(0);
  });
});
