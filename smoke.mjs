// Smoke verifier for UBP — vitest 환경 이슈(node_modules OS 불일치) 우회용.
// dist/ 의 컴파일 결과를 직접 import 하여 핵심 흐름을 확인한다.
//
// 실행: node smoke.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BlueprintStore } from "./dist/store.js";
import { blastRadius } from "./dist/core/impact.js";
import { detectMissing } from "./dist/core/missing.js";
import { extractBlueprintFromText } from "./dist/core/extract.js";
import { parsePolicy } from "./dist/core/policy.js";
import { computeCompliance } from "./dist/core/compliance.js";
import { scanCodeAnchors } from "./dist/core/code-anchor.js";
import { findConflicts } from "./dist/core/conflict.js";

let passed = 0,
  failed = 0;
const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

function run() {
  for (const { name, fn } of cases) {
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}\n    ${e.message}`);
    }
  }
}

// ============ impact ============
console.log("[impact]");
const bp = {
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
    { from: "n_b", to: "n_a", type: "depends-on" },
    { from: "n_c", to: "n_b", type: "depends-on" },
    { from: "n_m", to: "n_g", type: "supports" },
  ],
};
test("depends-on 전이 전파", () => {
  const r = blastRadius(bp, ["n_a"]);
  assert.ok(r.affected.includes("n_b"));
  assert.ok(r.affected.includes("n_c"));
});
test("supports 전파", () => {
  const r = blastRadius(bp, ["n_m"]);
  assert.ok(r.affected.includes("n_g"));
});
run();
cases.length = 0;

// ============ missing ============
console.log("\n[missing]");
test("feature 의 결여 슬롯 2종 검출", () => {
  const r = detectMissing({
    meta: { id: "t", title: "t", version: "0.1", rev: 1 },
    nodes: [{ id: "f", role: "feature", title: "F", status: "draft" }],
    edges: [],
  });
  assert.equal(r.length, 1);
  assert.ok(r[0].slots.includes("acceptance_criteria"));
  assert.ok(r[0].slots.includes("priority"));
});
test("claim 의 supports-edge 필수", () => {
  const r = detectMissing({
    meta: { id: "t", title: "t", version: "0.1", rev: 1 },
    nodes: [{ id: "c", role: "claim", title: "C", status: "draft" }],
    edges: [],
  });
  assert.ok(r[0].slots.includes("supports-edge>=1"));
});
run();
cases.length = 0;

// ============ extract ============
console.log("\n[extract]");
test("헤딩 + 리스트 추출", () => {
  const r = extractBlueprintFromText(`# 제품
- [Feature] 로그인: 구글/카카오`);
  const feat = r.nodes.find((n) => n.role === "feature");
  assert.ok(feat);
  assert.ok(feat.attrs?.acceptance_criteria.includes("구글"));
});
test("data-entity fields 콤마 분리", () => {
  const r = extractBlueprintFromText(`# 제품
- [entity] User: id, email, createdAt`);
  const ent = r.nodes.find((n) => n.role === "data-entity");
  assert.ok(ent);
  assert.ok(Array.isArray(ent.attrs?.fields));
  assert.equal(ent.attrs.fields.length, 3);
});
run();
cases.length = 0;

// ============ policy ============
console.log("\n[policy]");
test("Required Slots 파싱", () => {
  const p = parsePolicy(`## Required Slots
- \`feature\`: [acceptance_criteria, priority]
- \`data-entity\`: [fields]`);
  assert.deepEqual(p.requiredSlots.feature, ["acceptance_criteria", "priority"]);
});
test("Terminology Rules 파싱", () => {
  const p = parsePolicy(`## Terminology Rules
- \`화이트보드\` -> \`Whiteboard GUI\``);
  assert.equal(p.terminologyRules["화이트보드"], "Whiteboard GUI");
});
run();
cases.length = 0;

// ============ store ============
console.log("\n[store]");
const dir = mkdtempSync(join(tmpdir(), "ubp-smoke-"));
const seed = {
  meta: { id: "bp", title: "Test", version: "0.1", rev: 1 },
  nodes: [
    { id: "n_root", role: "product", title: "root", status: "confirmed" },
    { id: "n_a", role: "feature", title: "A", status: "draft", priority: "P0", attrs: { acceptance_criteria: "AC" } },
  ],
  edges: [{ from: "n_a", to: "n_root", type: "parent" }],
};
test("propose 는 BP 변경 안 함", () => {
  const s = new BlueprintStore(seed, join(dir, "bp1.json"));
  const before = s.rev();
  s.propose([{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }], "t");
  assert.equal(s.rev(), before);
  assert.equal(s.get().nodes.find((n) => n.id === "n_a").status, "draft");
});
test("confirm 시 rev +1, 영속화", () => {
  const path = join(dir, "bp2.json");
  const s = new BlueprintStore(seed, path);
  const p = s.propose([{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }], "t");
  const r = s.confirm(p.id, { actor: "user" });
  assert.equal(r.rev, 2);
  const onDisk = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(onDisk.meta.rev, 2);
});
test("baseRev mismatch 시 confirm 거부", () => {
  const s = new BlueprintStore(seed, join(dir, "bp3.json"));
  const p1 = s.propose([{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }], "1");
  const p2 = s.propose([{ op: "update_node", id: "n_a", patch: { priority: "P1" } }], "2", { baseRev: 1 });
  s.confirm(p1.id);
  const r = s.confirm(p2.id);
  assert.equal(r, null);
});
test("snapshot 생성 + restore", () => {
  const s = new BlueprintStore(seed, join(dir, "bp4.json"));
  const p = s.propose([{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }], "t");
  const r = s.confirm(p.id);
  assert.equal(r.snapshotSha.length, 12);
  const snaps = s.listSnapshots();
  assert.ok(snaps.length >= 1);
  const p2 = s.propose([{ op: "remove_node", id: "n_a" }], "remove");
  s.confirm(p2.id);
  assert.equal(s.get().nodes.find((n) => n.id === "n_a"), undefined);
  s.restore(r.snapshotSha);
  assert.ok(s.get().nodes.find((n) => n.id === "n_a"));
});
test("audit append-only", () => {
  const path = join(dir, "bp5.json");
  const auditPath = join(dir, "audit.jsonl");
  const s = new BlueprintStore(seed, path);
  const p = s.propose([{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }], "t");
  s.confirm(p.id);
  assert.ok(existsSync(auditPath));
  const kinds = readFileSync(auditPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).kind);
  assert.ok(kinds.includes("propose"));
  assert.ok(kinds.includes("confirm"));
  assert.ok(kinds.includes("snapshot"));
});
run();
cases.length = 0;

// ============ compliance ============
console.log("\n[compliance]");
const baseTs = 1_700_000_000_000;
test("matchRate: add_node 분모 제외, 알려진 anchor 매칭만 카운트", () => {
  const audit = [
    { ts: baseTs, kind: "confirm", actor: "u", ops: [{ op: "add_node", node: { id: "n_a", role: "feature", title: "A", status: "draft" } }] },
    { ts: baseTs + 1000, kind: "confirm", actor: "u", ops: [{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }] },
    { ts: baseTs + 2000, kind: "confirm", actor: "u", ops: [{ op: "update_node", id: "n_ghost", patch: { status: "confirmed" } }] },
  ];
  const s = computeCompliance(audit);
  assert.equal(s.anchorCountableOps, 2);
  assert.equal(s.anchorMatchedOps, 1);
  assert.ok(Math.abs(s.matchRate - 0.5) < 1e-6);
});
test("manualPatchRate: 윈도우 내 같은 노드 재패치 카운트", () => {
  const audit = [
    { ts: baseTs, kind: "confirm", actor: "u", ops: [{ op: "add_node", node: { id: "n_a", role: "feature", title: "A", status: "draft" } }] },
    { ts: baseTs + 30_000, kind: "confirm", actor: "u", ops: [{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }] },
  ];
  const s = computeCompliance(audit, 60_000);
  assert.equal(s.followUpPatchedConfirms, 1);
  assert.ok(Math.abs(s.manualPatchRate - 0.5) < 1e-6);
});
run();
cases.length = 0;

// ============ code-anchor (T1) ============
console.log("\n[code-anchor]");
const anchorDir = mkdtempSync(join(tmpdir(), "ubp-anchor-"));
try {
  writeFileSync(join(anchorDir, "a.ts"), `// some code\n// @ubp-anchor: #n_login\nexport const x = 1;\n`);
  mkdirSync(join(anchorDir, "sub"), { recursive: true });
  writeFileSync(join(anchorDir, "sub", "b.py"), `# header\n# @ubp-anchor: #n_login.attrs.acceptance_criteria\n`);
  writeFileSync(join(anchorDir, "c.md"), `<!-- @ubp-anchor: #n_dashboard -->\n# Title\n`);
  writeFileSync(join(anchorDir, "ignore.txt"), `@ubp-anchor: #n_should_not_match`);
  test("3개 다른 언어 코멘트에서 마커 추출", () => {
    const hits = scanCodeAnchors(anchorDir);
    assert.equal(hits.length, 3);
    const ids = new Set(hits.map((h) => h.nodeId));
    assert.ok(ids.has("n_login"));
    assert.ok(ids.has("n_dashboard"));
  });
  test("path 캡처: attrs.acceptance_criteria", () => {
    const hits = scanCodeAnchors(anchorDir);
    const py = hits.find((h) => h.file.includes("b.py"));
    assert.equal(py.path, "attrs.acceptance_criteria");
  });
  test(".txt 같은 미지원 확장자는 무시", () => {
    const hits = scanCodeAnchors(anchorDir);
    assert.equal(hits.find((h) => h.file.endsWith(".txt")), undefined);
  });
} finally {
  // anchor 디렉토리 정리는 마지막에
}
run();
cases.length = 0;

// ============ conflict (T3) ============
console.log("\n[conflict]");
test("동일 노드 attr 변경 시 충돌 쌍 검출", () => {
  const pending = [
    {
      id: "p1", intent: "A", actor: "agent-1", baseRev: 1,
      ops: [{ op: "update_node", id: "n_a", patch: { attrs: { acceptance_criteria: "AC1" } } }],
    },
    {
      id: "p2", intent: "B", actor: "agent-2", baseRev: 1,
      ops: [{ op: "update_node", id: "n_a", patch: { attrs: { acceptance_criteria: "AC2" } } }],
    },
  ];
  const conflicts = findConflicts(pending);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].anchor.path, "attrs.acceptance_criteria");
});
test("다른 노드면 충돌 0", () => {
  const pending = [
    { id: "p1", intent: "A", actor: "x", baseRev: 1, ops: [{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }] },
    { id: "p2", intent: "B", actor: "y", baseRev: 1, ops: [{ op: "update_node", id: "n_b", patch: { status: "confirmed" } }] },
  ];
  assert.equal(findConflicts(pending).length, 0);
});
test("3개 propose 가 같은 노드 attr 만지면 3쌍 검출 (각 쌍별)", () => {
  const pending = [1, 2, 3].map((i) => ({
    id: `p${i}`, intent: `${i}`, actor: `a${i}`, baseRev: 1,
    ops: [{ op: "update_node", id: "n_a", patch: { attrs: { priority: `P${i}` } } }],
  }));
  // p1-p2, p1-p3, p2-p3 = 3쌍
  assert.equal(findConflicts(pending).length, 3);
});
run();
cases.length = 0;

// ============ authz (T2) ============
console.log("\n[authz]");
test("authz 미설정 시 모든 actor 통과 (behavior 보존)", () => {
  const s = new BlueprintStore(seed, join(dir, "az1.json"));
  const p = s.propose([{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }], "t", { actor: { id: "u1", role: "viewer" } });
  const r = s.confirm(p.id, { actor: { id: "u1", role: "viewer" } });
  assert.ok(r); // 디폴트는 viewer 도 confirm 가능
});
test("authz 활성 시 viewer 는 confirm 거부", () => {
  const s = new BlueprintStore(seed, join(dir, "az2.json"), { authz: {} });
  const p = s.propose([{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }], "t", { actor: { id: "u1", role: "viewer" } });
  const r = s.confirm(p.id, { actor: { id: "u1", role: "viewer" } });
  assert.equal(r, null);
});
test("authz 활성 시 editor 는 confirm 통과, restore 는 owner 만", () => {
  const s = new BlueprintStore(seed, join(dir, "az3.json"), { authz: {} });
  const p = s.propose([{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }], "t", { actor: { id: "u2", role: "editor" } });
  const r = s.confirm(p.id, { actor: { id: "u2", role: "editor" } });
  assert.ok(r);
  // editor 가 restore 시도 → null
  const rr = s.restore(r.snapshotSha, { actor: { id: "u2", role: "editor" } });
  assert.equal(rr, null);
  // owner 는 통과
  const ok = s.restore(r.snapshotSha, { actor: { id: "u3", role: "owner" } });
  assert.ok(ok);
});
run();
cases.length = 0;

// ============ cleanup ============
try {
  rmSync(dir, { recursive: true, force: true });
  rmSync(anchorDir, { recursive: true, force: true });
} catch {}

console.log(`\n${passed} passed · ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
