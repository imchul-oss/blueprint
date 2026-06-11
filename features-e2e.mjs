// 신규 피처 e2e — sinceRev delta · target 프로파일 · read_attachments · check_anchor_drift ·
// 자가승인 차단(UBP_FORBID_SELF_CONFIRM) · extract 왕복 id 보존
// 실행: npm run build && node features-e2e.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { extractBlueprintFromText } from "./dist/core/extract.js";
import { serializeForModel } from "./dist/core/serialize.js";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

// ============ in-process: 왕복 id 보존 + 서빙 프로파일 ============
console.log("[왕복·프로파일]");

await test("#10: <!-- @ubp: #id --> 주석으로 노드 id 가 왕복 보존된다", () => {
  const md = `# 정책
- **[claim/P0]** 환각 금지 <!-- @ubp: #n_claim_halluc -->
- [feature] 새 항목: 신규 추가`;
  const r = extractBlueprintFromText(md);
  assert.ok(r.nodes.some(n => n.id === "n_claim_halluc"), "명시 id 미보존");
  const claim = r.nodes.find(n => n.id === "n_claim_halluc");
  assert.equal(claim.role, "claim", `**[claim/P0]** 파싱 실패: ${claim.role}`);
  assert.equal(claim.priority, "P0", "priority 세그먼트 미파싱");
  assert.equal(claim.title, "환각 금지");
  const fresh = r.nodes.find(n => n.title === "새 항목");
  assert.ok(fresh && fresh.id.startsWith("n_item_"), "주석 없는 항목은 신규 id");
});

await test("#10: 단독 라인 주석은 다음 라인에 적용 + 중복 id 는 fallback", () => {
  const md = `# 목록
<!-- @ubp: #n_dup -->
- [feature] 첫째
- [feature] 둘째 <!-- @ubp: #n_dup -->`;
  const r = extractBlueprintFromText(md);
  const first = r.nodes.find(n => n.title === "첫째");
  const second = r.nodes.find(n => n.title === "둘째");
  assert.equal(first.id, "n_dup");
  assert.notEqual(second.id, "n_dup", "중복 id 충돌 미처리");
});

await test("#7: target 프로파일이 렌더 지침을 타깃별로 바꾼다", () => {
  const bp = { meta: { id: "t", title: "T", version: "1", rev: 1 }, nodes: [{ id: "n_a", role: "claim", title: "A", status: "draft" }], edges: [] };
  const prd = serializeForModel(bp, { target: "prd" });
  const pol = serializeForModel(bp, { target: "policy" });
  const plain = serializeForModel(bp);
  assert.ok(prd.summary.includes("서빙 프로파일: PRD"));
  assert.ok(pol.summary.includes("정책/하네스"));
  assert.ok(!plain.summary.includes("서빙 프로파일"), "미지정 시 무프로파일이어야");
});

// ============ MCP stdio: delta · 첨부 · drift · 자가승인 ============
console.log("\n[MCP stdio 피처]");

const tmpDir = mkdtempSync(join(tmpdir(), "ubp-feat-"));
const storePath = join(tmpDir, "bp.json");
// 코드 anchor 스캔용 디렉토리: 유효 anchor 1 + 고아 anchor 1
const codeDir = join(tmpDir, "code");
mkdirSync(codeDir, { recursive: true });
writeFileSync(join(codeDir, "a.ts"), `// @ubp-anchor: #n_root\nexport const a = 1;\n// @ubp-anchor: #n_ghost_zzz\n`);

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/mcp-server.js"],
  env: { ...process.env, UBP_STORE: storePath, UBP_FORBID_SELF_CONFIRM: "1" },
});
const client = new Client({ name: "feat-test", version: "0.1.0" });
await client.connect(transport);
const textOf = (r) => r.content.map((c) => c.text ?? "").join("\n");
const call = async (name, args = {}) => textOf(await client.callTool({ name, arguments: args }));

try {
  // 자가승인 차단: agent 가 올리고 agent 가 confirm → 거부
  const ops = JSON.stringify([
    { op: "add_node", node: { id: "n_feat_x", role: "feature", title: "피처X", priority: "P1", status: "draft", attachments: [
      { id: "att1", kind: "image", title: "목업", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" },
      { id: "att2", kind: "link", title: "참고", url: "https://example.com/spec" },
    ] } },
    { op: "add_edge", edge: { from: "n_feat_x", to: "n_root", type: "parent" } },
  ]);
  const prop = await call("propose_update", { ops, intent: "feat e2e", actor: "agent-a" });
  const pid = prop.match(/제안 (p_\w+)/)?.[1];
  assert.ok(pid, "pid 캡처 실패");

  await test("#4: 자가승인 차단 — 같은 actor 의 confirm 거부", async () => {
    const r = await call("confirm_update", { proposalId: pid, actor: "agent-a" });
    assert.ok(r.includes("ERROR") && r.includes("자가승인"), r.slice(0, 120));
  });
  await test("#4: 다른 actor(사람) confirm 은 통과", async () => {
    const r = await call("confirm_update", { proposalId: pid, actor: "human-reviewer" });
    assert.ok(!r.includes("ERROR"), r.slice(0, 120));
  });
  await test("propose 응답에 [impact_json] 구조화 라인 포함", () => {
    assert.ok(prop.includes("[impact_json]"));
    const j = JSON.parse(prop.split("[impact_json]")[1].trim());
    assert.equal(j.proposalId, pid);
  });

  await test("#5: sinceRev delta — 변경 노드만 반환", async () => {
    const delta = await call("read_blueprint", { sinceRev: 1 });
    assert.ok(delta.includes("[delta:"), "delta 주석 없음");
    assert.ok(delta.includes("n_feat_x"), "변경 노드 누락");
    const full = await call("read_blueprint", {});
    assert.ok(delta.length < full.length, "delta 가 전체보다 작지 않음");
  });
  await test("#5: sinceRev=현재 rev → 변경 없음 응답", async () => {
    const r = await call("read_blueprint", { sinceRev: 999 });
    assert.ok(r.includes("변경 없음"));
  });
  await test("#7: MCP target=policy 프로파일 적용", async () => {
    const r = await call("read_blueprint", { target: "policy" });
    assert.ok(r.includes("정책/하네스"));
  });
  await test("#6: read_attachments — 이미지 블록 + 링크 목록", async () => {
    const res = await client.callTool({ name: "read_attachments", arguments: { nodeId: "n_feat_x" } });
    const kinds = res.content.map(c => c.type);
    assert.ok(kinds.includes("image"), `이미지 블록 없음: ${kinds}`);
    const txt = textOf(res);
    assert.ok(txt.includes("https://example.com/spec"));
  });
  await test("#6: 첨부 없는 노드/없는 노드 처리", async () => {
    assert.ok((await call("read_attachments", { nodeId: "n_root" })).includes("첨부 없음"));
    assert.ok((await call("read_attachments", { nodeId: "n_nope" })).includes("ERROR"));
  });
  await test("#9: check_anchor_drift — 고아 anchor + 미커버 노드 검출", async () => {
    const r = await call("check_anchor_drift", { dir: codeDir });
    assert.ok(r.includes("n_ghost_zzz"), "고아 anchor 미검출");
    assert.ok(r.includes("끊어진 anchor"), "고아 섹션 없음");
    // n_feat_x 는 confirmed 가 아니어서(draft) 미커버 목록 대상 아님 — confirmed 만 잡는지 확인
    assert.ok(!r.split("미커버")[1]?.includes("n_feat_x"), "draft 노드가 미커버에 포함됨");
  });
} finally {
  await client.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

console.log(`\n${passed} passed · ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
