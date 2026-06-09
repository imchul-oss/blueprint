/**
 * 진짜 MCP e2e: 클라이언트가 서버를 spawn 해서 stdio 로 툴을 호출한다.
 * 소비 모델(Claude Code/Cursor)이 우리 서버에 붙는 흐름을 그대로 모사.
 * 격리: 임시 UBP_STORE 로 실 .blueprint 비오염. confirm 반영을 hard-assert.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "ubp-e2e-"));
const storePath = join(tmpDir, "bp.json");

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/mcp-server.js"],
  env: { ...(process.env as Record<string, string>), UBP_STORE: storePath },
});
const client = new Client({ name: "ubp-test-client", version: "0.1.0" });
await client.connect(transport);

const textOf = (r: any) => r.content.map((c: any) => c.text ?? "").join("\n");

try {
  const tools = await client.listTools();
  console.log("툴 목록:", tools.tools.map((t) => t.name).join(", "));
  assert.ok(tools.tools.length >= 20, `tool 20+ 기대, 실제 ${tools.tools.length}`);

  console.log("\n--- read_blueprint (앞 6줄) ---");
  const read = await client.callTool({ name: "read_blueprint", arguments: {} });
  console.log(textOf(read).split("\n").slice(0, 6).join("\n"));

  console.log("\n--- propose_update (confirm 게이트 1단계) ---");
  const ops = JSON.stringify([
    { op: "add_node", node: { id: "n_demo", role: "feature", title: "데모로 추가된 기능", priority: "P1", status: "draft" } },
    { op: "add_edge", edge: { from: "n_demo", to: "n_root", type: "parent" } },
  ]);
  const prop = await client.callTool({ name: "propose_update", arguments: { ops, intent: "e2e 데모: 기능 추가" } });
  console.log(textOf(prop));

  const pid = textOf(prop).match(/제안 (p_\w+)/)?.[1] ?? "";
  assert.ok(pid, "proposalId 캡처 실패 (응답 포맷 변경?)");

  // confirm 전: propose 가 반영되면 안 됨 (게이트)
  const midRead = await client.callTool({ name: "read_blueprint", arguments: {} });
  assert.ok(!textOf(midRead).includes("n_demo"), "confirm 전 propose 가 반영됨 (게이트 위반)");

  console.log("\n--- confirm_update (2단계) ---");
  const conf = await client.callTool({ name: "confirm_update", arguments: { proposalId: pid } });
  console.log(textOf(conf));

  console.log("\n--- read_blueprint 재확인 (n_demo 반영?) ---");
  const read2 = await client.callTool({ name: "read_blueprint", arguments: {} });
  assert.ok(textOf(read2).includes("n_demo"), "confirm 후에도 n_demo 미반영 — confirm 경로 깨짐");
  console.log("✅ n_demo 반영됨");

  // ============ 도구 표면 커버리지 (20개 중 핵심) ============
  console.log("\n--- 도구 표면 커버리지 ---");
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    textOf(await client.callTool({ name, arguments: args }));

  // get_policy — BLUEPRINT.md 정책 핫로드 + feature 필수 슬롯
  const policy = JSON.parse(await call("get_policy"));
  assert.ok(policy.requiredSlots?.feature?.includes("acceptance_criteria"),
    "get_policy: feature 필수 슬롯에 acceptance_criteria");

  // get_harness — 작업 시작 번들에 정책 섹션
  const harness = await call("get_harness");
  assert.ok(harness.includes("Policy") && harness.includes("Required Slots"),
    "get_harness: 정책 섹션 포함");

  // get_missing — n_demo(feature)는 acceptance_criteria 결여 → 표면화
  assert.ok((await call("get_missing")).includes("n_demo"),
    "get_missing: n_demo 결여 슬롯 표면화");

  // refine_missing_context — 결여 채움 컨텍스트 (UBP는 LLM 호출 안 함)
  const refine = await call("refine_missing_context");
  assert.ok(refine.includes("Missing Slots") && refine.includes("n_demo"),
    "refine_missing_context: 결여 노드 컨텍스트");

  // verify_bp_context / compliance_summary_for_llm — 정합률 자가점검
  assert.ok((await call("verify_bp_context")).includes("matchRate"),
    "verify_bp_context: matchRate 포함");
  assert.ok((await call("compliance_summary_for_llm")).includes("matchRate"),
    "compliance_summary_for_llm: matchRate 포함");
  const compStats = await call("compliance_stats");
  assert.ok(compStats.includes("matchRate") && !compStats.startsWith("ERROR"),
    "compliance_stats: matchRate 통계 포함");
  console.log("✅ get_policy/get_harness/get_missing/refine/verify/compliance");

  // tail_audit — propose+confirm 기록 존재
  assert.ok((await call("tail_audit", { n: 50 })).includes("confirm"),
    "tail_audit: confirm 기록 포함");

  // propose → list_pending → critic → list_conflicts → reject → list_pending 전이
  const pid2 = (await call("propose_update", {
    ops: JSON.stringify([{ op: "update_node", id: "n_demo", patch: { status: "deferred" } }]),
    intent: "테스트 거절용",
  })).match(/제안 (p_\w+)/)?.[1] ?? "";
  assert.ok(pid2, "두번째 proposalId 캡처");
  assert.ok((await call("list_pending")).includes(pid2), "list_pending: 대기 제안 포함");
  assert.ok((await call("critic_pending_context")).includes(pid2), "critic_pending_context: 대기 제안 번들");
  assert.ok(!(await call("list_conflicts")).startsWith("ERROR"), "list_conflicts: 정상 응답");
  assert.ok((await call("reject_update", { proposalId: pid2 })).includes("거절"), "reject_update: 거절");
  assert.ok(!(await call("list_pending")).includes(pid2), "list_pending: 거절 후 제거");
  console.log("✅ propose→list_pending→critic→reject 전이");

  // propose_from_prompt — 로컬 orchestrator 파싱 (LLM 없음). 성공 시 정리.
  const pfp = await call("propose_from_prompt", { prompt: "추가 feature 회원가입, 우선순위 P0" });
  // 성공이면 "propose <id>", 파싱 거절이면 "ERROR … confidence=" — 둘 중 하나여야(빈 응답/크래시는 RED)
  assert.ok(pfp.includes("propose") || (pfp.includes("ERROR") && pfp.includes("confidence")),
    "propose_from_prompt: propose 성공 또는 confidence 동반 graceful 거절");
  const pfpId = pfp.match(/propose (p_\w+)/)?.[1];
  if (pfpId) await call("reject_update", { proposalId: pfpId });
  console.log("✅ propose_from_prompt: " + pfp.split("\n")[0]);

  // scan_code_anchors + anchor_to_propose — 코드↔BP 추적성 (temp fixture)
  writeFileSync(join(tmpDir, "anchor-fixture.ts"), "// @ubp-anchor: #n_demo\nexport const x = 1;\n");
  assert.ok((await call("scan_code_anchors", { root: tmpDir })).includes("n_demo"),
    "scan_code_anchors: fixture 마커 추출");
  const a2p = await call("anchor_to_propose", { root: tmpDir });
  assert.ok(a2p.includes("propose") || a2p.includes("anchor"),
    "anchor_to_propose: 정상 응답");
  const a2pId = a2p.match(/propose (p_\w+)/)?.[1];
  if (a2pId) await call("reject_update", { proposalId: a2pId });
  console.log("✅ scan_code_anchors + anchor_to_propose");

  // list_snapshots → restore_snapshot 라운드트립 (confirm 시 생성된 스냅샷)
  const sha = (await call("list_snapshots")).match(/sha=(\w+)/)?.[1] ?? "";
  assert.ok(sha, "list_snapshots: 스냅샷 ≥1 + sha 캡처");
  assert.ok((await call("restore_snapshot", { sha })).includes("복구 완료"),
    "restore_snapshot: 복구 성공");
  console.log("✅ list_snapshots → restore 라운드트립");

  console.log("\n✅ e2e 완료 (tool 표면 커버리지 포함)");
} finally {
  await client.close();
  rmSync(tmpDir, { recursive: true, force: true });
}
