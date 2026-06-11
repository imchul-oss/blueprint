// Purpose-level e2e — UBP 의 목적이 실제로 달성되는지 전체 사슬로 검증한다.
// 피처 단위(smoke.mjs)와 달리, BLUEPRINT.md §1~2 의 목적 자체를 시나리오로 묶는다:
//
//   [J1] 회의록 → 블루프린트 골격 추출
//   [J3] 누락 정보는 추측으로 채우지 않고 missing 으로 표면화 (환각 통제)
//   [P6] 그래프를 모델 소비 형태로 직렬화 (렌더 위임)
//   [P1+P5] 웹(외부 writer)과 MCP 가 같은 bp.json 을 만질 때:
//           stale confirm 거부 + 외부 변경 보존 + 재제안 수렴 (단일 진실원천)
//   [P2] propose→confirm 게이트 (confirm 전 미반영)
//   [감사] reject 가 audit 에 rev_mismatch 로 남는다
//
// 실행: npm run build && node purpose-e2e.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { extractBlueprintFromText } from "./dist/core/extract.js";
import { detectMissing } from "./dist/core/missing.js";
import { serializeForModel } from "./dist/core/serialize.js";

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${e.message}`);
  }
}

// ============================================================
// Part 1 — 저작 사슬: 회의록 → 골격 → 환각 통제 → 모델 직렬화
// ============================================================
console.log("[목적 1] 회의록 → 골격 → 환각 통제 → 모델 서빙");

const meetingNotes = `# 신규 온보딩 개선
- [Feature] 셀프 온보딩 체크리스트
- [Feature] 계정 자동 프로비저닝: IT 시스템 연동으로 입사일 전 완료
- [entity] Employee: id, name, startDate`;

const draft = extractBlueprintFromText(meetingNotes);

await test("J1: 회의록에서 feature/entity 골격이 추출된다", () => {
  const feats = draft.nodes.filter((n) => n.role === "feature");
  assert.equal(feats.length, 2);
  const ent = draft.nodes.find((n) => n.role === "data-entity");
  assert.ok(ent);
  assert.deepEqual(ent.attrs.fields, ["id", "name", "startDate"]);
});

await test("J3: 명시 안 된 슬롯은 추측으로 채우지 않는다 (환각 통제)", () => {
  // '셀프 온보딩 체크리스트'는 콜론 설명이 없다 → acceptance_criteria 가 발명되면 안 됨
  const bare = draft.nodes.find((n) => n.title.includes("셀프 온보딩"));
  assert.ok(bare);
  assert.ok(!bare.attrs?.acceptance_criteria, "없는 정보를 추출기가 발명함");
});

await test("J3: detectMissing 이 빈 슬롯을 clarify 대상으로 표면화한다", () => {
  const missing = detectMissing(draft);
  const bare = draft.nodes.find((n) => n.title.includes("셀프 온보딩"));
  const hit = missing.find((m) => m.nodeId === bare.id);
  assert.ok(hit, "빈 슬롯 노드가 missing 에 안 잡힘");
  assert.ok(hit.slots.includes("acceptance_criteria"));
});

await test("P6: serializeForModel 이 모델 소비 가능한 형태(JSON+요약+anchor)를 반환한다", () => {
  // extract 는 Omit<Blueprint,"meta"> 반환 — 실사용처럼 store 레이어가 meta 를 붙인다
  const bp = { meta: { id: "onboarding", title: "온보딩 개선", version: "0.1", rev: 1 }, ...draft };
  const s = serializeForModel(bp);
  assert.ok(s.summary.includes("셀프 온보딩"), "노드 내용이 요약에 없음");
  assert.ok(s.summary.includes("⚠미정"), "missing 슬롯이 모델에 안 보임 (환각 통제 누락)");
  assert.ok(s.summary.includes("렌더 지침"), "렌더 위임 지침 없음");
  assert.ok(s.anchors.length >= draft.nodes.length, "anchor 불충분 (drift 추적 불가)");
  assert.equal(s.json.nodes.length, draft.nodes.length);
});

// ============================================================
// Part 2 — 단일 진실원천: 웹(외부 writer) ↔ MCP 동시 편집 안전
//   미검증이던 reloadIfChanged + 낙관락 교차 경로를 실 stdio 로 증명.
// ============================================================
console.log("\n[목적 2] 웹↔MCP 동시 편집 — stale confirm 거부·외부 변경 보존 (MCP stdio)");

const tmpDir = mkdtempSync(join(tmpdir(), "ubp-purpose-"));
const storePath = join(tmpDir, "bp.json");

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/mcp-server.js"],
  env: { ...process.env, UBP_STORE: storePath },
});
const client = new Client({ name: "ubp-purpose-client", version: "0.1.0" });
await client.connect(transport);
const textOf = (r) => r.content.map((c) => c.text ?? "").join("\n");
const call = async (name, args = {}) => textOf(await client.callTool({ name, arguments: args }));

try {
  // MCP 가 제안을 올린다 (모델 측 변경)
  const ops = JSON.stringify([
    { op: "add_node", node: { id: "n_mcp_chg", role: "feature", title: "MCP가 제안한 기능", priority: "P1", status: "draft" } },
    { op: "add_edge", edge: { from: "n_mcp_chg", to: "n_root", type: "parent" } },
  ]);
  const prop = await call("propose_update", { ops, intent: "purpose-e2e: MCP 측 변경" });
  const pid = prop.match(/제안 (p_\w+)/)?.[1];
  assert.ok(pid, `proposalId 캡처 실패: ${prop}`);

  await test("P2: confirm 전에는 제안이 반영되지 않는다 (게이트)", async () => {
    const mid = await call("read_blueprint");
    assert.ok(!mid.includes("n_mcp_chg"));
  });

  // ★ 외부 writer 시뮬레이션: 웹 FileStore 가 같은 bp.json 을 저장 (rev 증가)
  const onDisk = JSON.parse(readFileSync(storePath, "utf8"));
  onDisk.nodes.push({ id: "n_web_chg", role: "note", title: "웹에서 동시 편집", status: "draft" });
  onDisk.meta.rev = (onDisk.meta.rev ?? 1) + 1;
  writeFileSync(storePath, JSON.stringify(onDisk, null, 2), "utf8");

  await test("P1+P5: 외부 변경 후 stale confirm 은 거부된다 (낙관락이 외부 writer 도 잡음)", async () => {
    const conf = await call("confirm_update", { proposalId: pid });
    assert.ok(conf.includes("ERROR"), `stale confirm 이 통과됨(침묵 덮어쓰기!): ${conf}`);
  });

  await test("P1: 거부 후 웹의 변경은 보존되고 MCP 제안은 미반영", async () => {
    const after = await call("read_blueprint");
    assert.ok(after.includes("n_web_chg"), "외부(웹) 변경이 유실됨");
    assert.ok(!after.includes("n_mcp_chg"), "거부된 제안이 반영됨");
  });

  await test("감사: reject 가 rev_mismatch 로 audit 에 남는다", async () => {
    const audit = await call("tail_audit", { n: 10 });
    assert.ok(audit.includes("rev_mismatch"), `audit 에 rev_mismatch 없음:\n${audit}`);
  });

  await test("P1: 최신 rev 기준 재제안 → confirm 성공, 양측 변경 공존(수렴)", async () => {
    const prop2 = await call("propose_update", { ops, intent: "purpose-e2e: 재제안" });
    const pid2 = prop2.match(/제안 (p_\w+)/)?.[1];
    assert.ok(pid2);
    const conf2 = await call("confirm_update", { proposalId: pid2 });
    assert.ok(!conf2.includes("ERROR"), `재제안 confirm 실패: ${conf2}`);
    const fin = await call("read_blueprint");
    assert.ok(fin.includes("n_web_chg") && fin.includes("n_mcp_chg"), "양측 변경 공존 실패");
    // 디스크의 단일 진실원천에도 둘 다 존재
    const disk = JSON.parse(readFileSync(storePath, "utf8"));
    assert.ok(disk.nodes.some((n) => n.id === "n_web_chg"));
    assert.ok(disk.nodes.some((n) => n.id === "n_mcp_chg"));
  });
} finally {
  await client.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

console.log(`\n${passed} passed · ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
