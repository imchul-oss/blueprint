import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { BlueprintStore } from "./store.js";
import { serializeForModel } from "./core/serialize.js";
import { detectMissing, missingToClarify } from "./core/missing.js";
import type { BlueprintOp } from "./core/ops.js";
import { PolicyWatcher } from "./core/policy-watcher.js";
import type { ProjectPolicy } from "./core/policy.js";
import { computeCompliance, formatCompliance } from "./core/compliance.js";
import { scanCodeAnchors, formatAnchorHits } from "./core/code-anchor.js";
import { findConflicts, formatConflicts } from "./core/conflict.js";
import { orchestrate } from "./core/orchestrator.js";
import { ubpSelf } from "./samples/ubp-self.js";

/**
 * MCP 서버 — Claude Code / Cursor 등 소비 모델에 blueprint read·propose·confirm·audit 노출.
 *
 * 안전 모델:
 *   - propose: 즉시 반영 안 함. impact·proposalId 만 회신.
 *   - confirm: 사람 actor 권장(actor 인수 필수화 가능). baseRev mismatch 시 거부.
 *   - audit/snapshot/restore: 모든 변경 추적 + 롤백 가능.
 */
const STORE_PATH = process.env.UBP_STORE ?? ".blueprint/bp.json";
try {
  mkdirSync(dirname(STORE_PATH) || ".", { recursive: true });
} catch {
  /* ignore */
}
const store = new BlueprintStore(ubpSelf, STORE_PATH);

// 정책 핫리로드 — BLUEPRINT.md 변경 시 currentPolicy 가 갱신됨.
const POLICY_PATH = process.env.UBP_POLICY ?? "BLUEPRINT.md";
const policyWatcher = new PolicyWatcher(POLICY_PATH, (next) => {
  currentPolicy = next;
  console.error(`[ubp] policy reloaded from ${POLICY_PATH}`);
});
let currentPolicy: ProjectPolicy = policyWatcher.initial();
policyWatcher.start();

const server = new McpServer({ name: "ubp", version: "0.2.0" });
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

server.tool(
  "read_blueprint",
  "현재 블루프린트를 JSON+자연어요약+anchor 형태로 반환. 이걸로 PRD/PPT/코드 등을 렌더하라.",
  {},
  async () => {
    const s = serializeForModel(store.get());
    const rev = store.rev();
    return text(
      `${s.summary}\n\n[meta.rev=${rev}]\n\n---\n[JSON]\n${JSON.stringify(s.json)}`,
    );
  },
);

server.tool(
  "get_policy",
  "현재 ProjectPolicy(JSON). BLUEPRINT.md 변경 시 핫리로드됨.",
  {},
  async () => text(JSON.stringify(currentPolicy, null, 2)),
);

server.tool("get_missing", "필수 슬롯이 빈 노드와 clarify 질문을 반환.", {}, async () => {
  const reports = detectMissing(store.get());
  if (reports.length === 0) return text("결여 0건.");
  return text(missingToClarify(reports).join("\n"));
});

server.tool(
  "propose_update",
  "블루프린트 변경을 제안한다(즉시 반영 아님). ops=JSON 배열 문자열, intent=변경 의도, actor=요청자, baseRev=propose 기준 rev(낙관락).",
  {
    ops: z.string().describe("BlueprintOp[] JSON 문자열"),
    intent: z.string(),
    actor: z.string().default("agent"),
    baseRev: z.number().optional().describe("propose 기준 rev. 미지정 시 현재 rev 사용."),
  },
  async ({ ops, intent, actor, baseRev }) => {
    let parsed: BlueprintOp[];
    try {
      parsed = JSON.parse(ops);
    } catch {
      return text("ERROR: ops 가 유효한 JSON 배열이 아닙니다.");
    }
    const p = store.propose(parsed, intent, { actor, baseRev });
    return text(
      `제안 ${p.id} 생성 (자동 반영 안 됨).\n` +
        `의도: ${p.intent}\n` +
        `요청자: ${p.actor}, baseRev: ${p.baseRev}\n` +
        `영향도: ${p.impact.level} (파급 ${p.impact.affected.length}개: ${
          p.impact.affectedTitles.join(", ") || "없음"
        })\n` +
        `-> 사람 확인 후 confirm_update("${p.id}", actor=user) 호출.`,
    );
  },
);

server.tool(
  "confirm_update",
  "제안된 변경을 실제로 반영한다(사람 승인 후). proposalId 필요, actor 권장.",
  { proposalId: z.string(), actor: z.string().default("user") },
  async ({ proposalId, actor }) => {
    const r = store.confirm(proposalId, { actor });
    if (!r) return text(`ERROR: 제안 ${proposalId} 없음/만료 또는 rev 충돌.`);
    return text(
      `반영 완료: ${r.result.applied}건 적용, ${r.result.rejected.length}건 거부. ` +
        `(영향 ${r.impact.level}, newRev=${r.rev}, snapshot=${r.snapshotSha})`,
    );
  },
);

server.tool(
  "reject_update",
  "제안된 변경을 거절한다. proposalId 필요, reason 권장.",
  { proposalId: z.string(), actor: z.string().default("user"), reason: z.string().optional() },
  async ({ proposalId, actor, reason }) => {
    const ok = store.reject(proposalId, { actor, reason });
    return text(ok ? `제안 ${proposalId} 거절.` : `ERROR: 제안 ${proposalId} 없음.`);
  },
);

server.tool("list_pending", "보류 중인 제안 목록.", {}, async () => {
  const ps = store.listPending();
  if (ps.length === 0) return text("보류 제안 없음.");
  return text(
    ps
      .map(
        (p) =>
          `- ${p.id} | actor=${p.actor} | baseRev=${p.baseRev} | ${p.impact.level} (${p.impact.affected.length}) | ${p.intent}`,
      )
      .join("\n"),
  );
});

server.tool(
  "tail_audit",
  "최근 감사 로그 N건 반환(propose/confirm/reject/snapshot/restore).",
  { n: z.number().default(20) },
  async ({ n }) => {
    const rows = store.tailAudit(n);
    if (rows.length === 0) return text("감사 로그 없음.");
    return text(rows.map((r) => JSON.stringify(r)).join("\n"));
  },
);

server.tool(
  "propose_from_prompt",
  "자연어 prompt 를 propose 로 변환 (orchestrator). 예: '추가 feature 회원가입, 우선순위 P0'.",
  {
    prompt: z.string().describe("자연어 명령"),
    actor: z.string().default("agent"),
    autoConfirm: z.boolean().default(false).describe("true 면 propose 후 즉시 confirm. 환각 통제 우회 — 주의"),
  },
  async ({ prompt, actor, autoConfirm }) => {
    const r = orchestrate(prompt);
    if (r.ops.length === 0) return text(`ERROR: 명령 파싱 실패 — "${prompt}". confidence=${r.confidence}`);
    const p = store.propose(r.ops, r.intent, { actor });
    const lines = [
      `propose ${p.id} 생성 (confidence=${r.confidence})`,
      `의도: ${p.intent}`,
      `영향도: ${p.impact.level} (파급 ${p.impact.affected.length}개)`,
    ];
    if (autoConfirm) {
      const c = store.confirm(p.id, { actor });
      if (c) lines.push(`auto-confirmed → rev=${c.rev}, snapshot=${c.snapshotSha}`);
      else lines.push(`auto-confirm 실패 — rev 충돌 또는 권한`);
    } else {
      lines.push(`-> confirm_update("${p.id}", actor=user) 호출 권장`);
    }
    return text(lines.join("\n"));
  },
);

server.tool(
  "scan_code_anchors",
  "코드/마크다운에서 `@ubp-anchor: #nodeId[.path]` 마커 스캔. vibecoder가 코드↔BP 추적성 확인 용.",
  {
    root: z.string().describe("스캔 시작 디렉토리 경로"),
    exts: z.array(z.string()).optional().describe("확장자 목록 (기본 .ts/.tsx/.js/.jsx/.mjs/.cjs/.py/.md)"),
  },
  async ({ root, exts }) => {
    const hits = scanCodeAnchors(root, { exts });
    return text(formatAnchorHits(hits));
  },
);

server.tool(
  "anchor_to_propose",
  "코드 anchor 스캔 결과를 traces-to 엣지 propose 로 변환. 코드↔BP 추적성 자동 구성.",
  {
    root: z.string().describe("스캔 시작 디렉토리"),
    syntheticTargetRole: z
      .string()
      .default("component")
      .describe("코드 anchor 가 가리키는 합성 노드(파일 단위) 생성 시 사용할 role"),
    actor: z.string().default("agent"),
  },
  async ({ root, syntheticTargetRole, actor }) => {
    const hits = scanCodeAnchors(root);
    if (hits.length === 0) return text("anchor 0건 — propose 없음");
    const bp = store.get();
    const nodeIds = new Set(bp.nodes.map((n) => n.id));
    const ops: BlueprintOp[] = [];
    // 파일 별 합성 노드 1개 — 파일 = code-side anchor target
    const fileNodes = new Map<string, string>(); // file → synthetic node id
    for (const h of hits) {
      if (!nodeIds.has(h.nodeId)) continue; // BP 에 없는 anchor 는 skip
      const fileNodeId =
        fileNodes.get(h.file) ?? `n_code_${h.file.replace(/[^A-Za-z0-9]/g, "_").slice(0, 40)}`;
      if (!fileNodes.has(h.file)) {
        fileNodes.set(h.file, fileNodeId);
        if (!nodeIds.has(fileNodeId)) {
          ops.push({
            op: "add_node",
            node: {
              id: fileNodeId,
              role: syntheticTargetRole as never,
              title: h.file,
              status: "stub",
              notes: `auto-generated from code anchor scan`,
            },
          });
          nodeIds.add(fileNodeId);
        }
      }
      // 중복 엣지 방지 — 이미 존재하면 skip
      const exists = bp.edges.some(
        (e) => e.from === fileNodeId && e.to === h.nodeId && e.type === "traces-to",
      );
      if (!exists)
        ops.push({
          op: "add_edge",
          edge: { from: fileNodeId, to: h.nodeId, type: "traces-to" },
        });
    }
    if (ops.length === 0) return text("새 traces-to 엣지 없음 — 모든 anchor 이미 매핑됨");
    const p = store.propose(ops, `code anchor scan: ${hits.length} hits → ${ops.length} ops`, {
      actor,
    });
    return text(
      `propose ${p.id} 생성 — ${ops.length}개 op (file 노드 + traces-to 엣지).\nconfirm_update("${p.id}") 호출.`,
    );
  },
);

server.tool(
  "list_conflicts",
  "보류 중 제안들 사이에서 동일 anchor(노드 또는 attr 경로)를 변경하는 충돌 쌍 보고.",
  {},
  async () => {
    const pending = store.listPending();
    const conflicts = findConflicts(pending);
    return text(formatConflicts(conflicts));
  },
);

server.tool(
  "compliance_stats",
  "audit.jsonl 기반 정합률·수동보정율 통계. n_metric 측정 정의 구현.",
  { windowMinutes: z.number().default(5) },
  async ({ windowMinutes }) => {
    const audit = store.tailAudit(10_000);
    const stats = computeCompliance(audit, windowMinutes * 60 * 1000);
    return text(formatCompliance(stats));
  },
);

server.tool(
  "critic_pending_context",
  "대기 중 propose 들의 컨텍스트를 외부 AI 검토용으로 묶어 반환. UBP는 LLM 호출하지 않음 — 호출자(외부 AI)가 자기 능력으로 violations·improvements 검토.",
  {},
  async () => {
    const pending = store.listPending();
    if (pending.length === 0) return text("대기 중 propose 없음.");
    const lines: string[] = [];
    lines.push("# Critic — Pending Proposals Review Context");
    lines.push("");
    lines.push("> 다음 propose 들에 대해 환각 통제 4축(필수 슬롯·confirm gate·snapshot·audit)·정합성·anchor 정확성 관점에서 violations 와 improvements 를 분석하라. UBP 본질 5축(카드+와이어 / 의미 그래프 / 산출물 X / 환각 통제 / 첨부) 도 함께 점검.");
    lines.push("");
    for (const p of pending) {
      lines.push(`## ${p.id} — ${p.intent}`);
      lines.push(`- actor: ${p.actor} · baseRev: ${p.baseRev} · 영향도: ${p.impact.level} (${p.impact.affected.length}개)`);
      lines.push(`- ops:`);
      lines.push("```json");
      lines.push(JSON.stringify(p.ops, null, 2));
      lines.push("```");
      lines.push("");
    }
    return text(lines.join("\n"));
  },
);

server.tool(
  "refine_missing_context",
  "결여 슬롯 노드들과 채울 context 를 외부 AI 검토용으로 반환. 호출자가 자기 능력으로 채울 값을 제안 — UBP 가 propose 자동 생성 안 함.",
  { limit: z.number().default(10) },
  async ({ limit }) => {
    const bp = store.get();
    const reports = detectMissing(bp);
    if (reports.length === 0) return text("결여 슬롯 없음 — 모든 필수 슬롯 충족.");
    const lines: string[] = [];
    lines.push("# Refine — Missing Slots Context");
    lines.push("");
    lines.push("> 다음 노드들의 결여 슬롯을 채울 값을 제안하라. 추측 금지 — 노드 title/body/관계로부터 합리적 추론 가능한 것만. 추론 어려우면 clarify 질문으로.");
    lines.push("");
    for (const r of reports.slice(0, limit)) {
      const node = bp.nodes.find((n) => n.id === r.nodeId);
      if (!node) continue;
      lines.push(`## #${node.id} — ${node.title}`);
      lines.push(`- role: ${node.role}${node.priority ? `, priority: ${node.priority}` : ""}`);
      if (node.body) lines.push(`- body: ${node.body}`);
      lines.push(`- ⚠ missing: ${r.slots.join(", ")}`);
      // 관계 컨텍스트
      const parents = bp.edges.filter((e) => e.from === r.nodeId && e.type === "parent").map((e) => e.to);
      const children = bp.edges.filter((e) => e.to === r.nodeId && e.type === "parent").map((e) => e.from);
      if (parents.length) lines.push(`- parents: ${parents.join(", ")}`);
      if (children.length) lines.push(`- children: ${children.join(", ")}`);
      lines.push("");
    }
    if (reports.length > limit) lines.push(`_… +${reports.length - limit} more (limit=${limit})_`);
    return text(lines.join("\n"));
  },
);

server.tool(
  "verify_bp_context",
  "전체 BP 를 검토용으로 묶어 반환. 호출자가 자기 능력으로 gap·정합성·약점 분석. UBP 는 분석하지 않음.",
  {},
  async () => {
    const bp = store.get();
    const stats = computeCompliance(store.tailAudit(10_000), 60 * 60 * 1000);
    const lines: string[] = [];
    lines.push("# Verify — Full BP Audit Context");
    lines.push("");
    lines.push("> 다음 BP 의 정합성·gap·약점·개선점을 분석하라. 본질 5축(카드+와이어 / 의미 그래프 / 산출물 X / 환각 통제 / 첨부) + 환각 통제 4축 부합 여부 점검. anchor orphan·required slot 누락·중복 노드·끊긴 supports 체인 등.");
    lines.push("");
    const s = serializeForModel(bp);
    lines.push(s.summary);
    lines.push("");
    lines.push("## Compliance Self-Stats");
    const pct = (x: number) => (Number.isNaN(x) ? "—" : (x * 100).toFixed(1) + "%");
    lines.push(`- matchRate: ${pct(stats.matchRate)} (목표 ≥ 90%)`);
    lines.push(`- manualPatchRate: ${pct(stats.manualPatchRate)} (목표 < 20%)`);
    lines.push(`- proposes/confirms/rejects: ${stats.totalProposes}/${stats.totalConfirms}/${stats.totalRejects}`);
    return text(lines.join("\n"));
  },
);

server.tool(
  "get_harness",
  "UBP 작업 시작 시 모델이 받아야 할 하네스 1개. BLUEPRINT.md 정책 + 현재 BP llms.txt + 환각 통제 자가점검 + 결여 슬롯 + pending 제안 — 모두 한 번에. 작업 시작에 호출 권장.",
  {},
  async () => {
    const bp = store.get();
    const policy = currentPolicy;
    const audit = store.tailAudit(10_000);
    const stats = computeCompliance(audit, 60 * 60 * 1000);
    const missingReports = detectMissing(bp);
    const pending = store.listPending();
    const conflicts = findConflicts(pending);
    const snapshots = store.listSnapshots();

    const lines: string[] = [];
    lines.push("# UBP Harness — 작업 시작 컨텍스트");
    lines.push("");
    lines.push("> 본 응답은 모델이 UBP 의미 그래프 위에서 작업할 때의 정책·상태·자가점검을 한 번에 묶은 패키지. CLAUDE.md 와 동등 역할.");
    lines.push("");

    // ============ 1. 정책 ============
    lines.push("## 1. Policy (BLUEPRINT.md)");
    lines.push("");
    lines.push("### Required Slots (역할별 필수)");
    for (const [role, slots] of Object.entries(policy.requiredSlots)) {
      if (slots.length === 0) continue;
      lines.push(`- ${role}: ${slots.join(", ")}`);
    }
    lines.push("");
    lines.push("### Trackable Attributes");
    for (const a of policy.trackableAttributes) lines.push(`- ${a}`);
    lines.push("");
    lines.push("### Blast Radius thresholds");
    lines.push(`- critical: ${policy.blastRadiusThresholds.critical}, warning: ${policy.blastRadiusThresholds.warning}`);
    if (Object.keys(policy.terminologyRules).length > 0) {
      lines.push("");
      lines.push("### Terminology Rules (사용 금지 → 권장)");
      for (const [from, to] of Object.entries(policy.terminologyRules)) lines.push(`- ${from} → ${to}`);
    }
    lines.push("");

    // ============ 2. 환각 통제 4축 ============
    lines.push("## 2. Hallucination Control (4축) — 불변");
    lines.push("- (a) **Required slots**: 위 정책 미충족 시 모델은 추측 채우기 금지. `missing_to_clarify` 활용.");
    lines.push("- (b) **Confirm gate**: 모든 BP 변경은 `propose_update` 만. 자동 적용 X. 사람 또는 권한 actor 의 `confirm_update` 필요.");
    lines.push("- (c) **Snapshot**: 모든 confirm 마다 BP 사본 보관. 잘못된 변경은 `restore_snapshot` 으로 롤백.");
    lines.push("- (d) **Audit**: 모든 propose/confirm/reject/snapshot/restore 가 `tail_audit` 로 추적 가능.");
    lines.push("");

    // ============ 3. 현재 BP 상태 ============
    lines.push("## 3. Current Blueprint");
    lines.push(`- meta: ${bp.meta.title} (id=${bp.meta.id}, v=${bp.meta.version}, rev=${bp.meta.rev ?? 1})`);
    lines.push(`- nodes: ${bp.nodes.length}, edges: ${bp.edges.length}, snapshots: ${snapshots.length}`);
    const roleCount: Record<string, number> = {};
    for (const n of bp.nodes) roleCount[n.role] = (roleCount[n.role] || 0) + 1;
    lines.push(`- roles: ${Object.entries(roleCount).map(([r, c]) => `${r}=${c}`).join(", ")}`);
    lines.push("");
    lines.push("### Anchor conventions");
    lines.push("- 노드: `#nodeId`");
    lines.push("- 속성: `#nodeId.attrs.<key>`");
    lines.push("- 코드 마커: `// @ubp-anchor: #nodeId[.path]` (다른 언어 코멘트도 지원)");
    lines.push("");

    // ============ 4. 자가 점검 ============
    const pct = (x: number) => (Number.isNaN(x) ? "—" : (x * 100).toFixed(1) + "%");
    const matchOk = !Number.isNaN(stats.matchRate) && stats.matchRate >= 0.90;
    const manualOk = stats.manualPatchRate < 0.20;
    lines.push("## 4. Self-Check (지난 1h)");
    lines.push(`- matchRate: **${pct(stats.matchRate)}** ${matchOk ? "✅" : "⚠️"} (목표 ≥ 90% — anchor 매칭률)`);
    lines.push(`- manualPatchRate: **${pct(stats.manualPatchRate)}** ${manualOk ? "✅" : "⚠️"} (목표 < 20% — confirm 후 후속 patch)`);
    lines.push(`- proposes/confirms/rejects: ${stats.totalProposes} / ${stats.totalConfirms} / ${stats.totalRejects}`);
    if (missingReports.length > 0) {
      lines.push(`- ⚠ Missing slots: ${missingReports.length} 노드`);
      for (const m of missingReports.slice(0, 5)) lines.push(`  - #${m.nodeId} (${m.title}): ${m.slots.join(", ")}`);
    } else {
      lines.push(`- ✅ Missing slots: 0`);
    }
    if (pending.length > 0) {
      lines.push(`- ⚠ Pending proposals (confirm gate 대기): ${pending.length}`);
    }
    if (conflicts.length > 0) {
      lines.push(`- ⚠ Anchor conflicts (다중 propose 동일 anchor): ${conflicts.length}`);
    }
    lines.push("");

    // ============ 5. 행동 가이드 ============
    lines.push("## 5. Guidance");
    lines.push("1. 변경 시 기존 anchor 우선 — `update_node` / `add_edge` 가 `add_node` 보다 정합률 ↑");
    lines.push("2. 필수 슬롯 비면 추측 X — 사용자에게 clarify 질문 또는 `note` role 로 보류");
    lines.push("3. 큰 변경은 한 `propose` 에 묶기 — 후속 patch 율 ↓");
    lines.push("4. 산출물(.pptx/.docx) 직접 생성 X — UBP 는 의미 그래프 뼈대만. 변환은 외부 도구.");
    lines.push("5. 노드에 시각 레퍼런스(이미지·sketch·링크·파일) 가 있으면 'attachments' 메타도 함께 해석.");
    lines.push("");

    // ============ 6. 사용 가능한 도구 ============
    lines.push("## 6. Available MCP Tools");
    lines.push("- read_blueprint / get_missing / get_policy");
    lines.push("- propose_update / confirm_update / reject_update / list_pending");
    lines.push("- list_conflicts / list_snapshots / restore_snapshot");
    lines.push("- tail_audit / compliance_stats / compliance_summary_for_llm");
    lines.push("- scan_code_anchors / anchor_to_propose / propose_from_prompt");
    lines.push("- get_harness (this)");

    return text(lines.join("\n"));
  },
);

server.tool(
  "compliance_summary_for_llm",
  "LLM 자가 점검용 정합률 요약. 모델이 자기 propose 가 anchor 매칭률·환각 통제 4축에 얼마나 부합하는지 self-check 가능.",
  { windowMinutes: z.number().default(60) },
  async ({ windowMinutes }) => {
    const audit = store.tailAudit(10_000);
    const stats = computeCompliance(audit, windowMinutes * 60 * 1000);
    const bp = store.get();
    const missingReports = detectMissing(bp);
    const pending = store.listPending();

    const pct = (x: number) => (Number.isNaN(x) ? "—" : (x * 100).toFixed(1) + "%");
    const matchOk = !Number.isNaN(stats.matchRate) && stats.matchRate >= 0.90;
    const manualOk = stats.manualPatchRate < 0.20;

    const lines: string[] = [];
    lines.push("# UBP Compliance Self-Check");
    lines.push("");
    lines.push("> 모델이 자기 변경 패턴을 self-audit 하기 위한 요약. 4축 본질(필수 슬롯 / Confirm gate / Snapshot / Audit) 모두 활성.");
    lines.push("");
    lines.push("## Targets (n_metric 정의)");
    lines.push("- matchRate >= 90%  (anchor 매칭 ops / 전체 ops; add_node 분모 제외)");
    lines.push("- manualPatchRate < 20%  (confirm 후 windowMs 안에 같은 노드 patch 비율)");
    lines.push("");
    lines.push("## Current");
    lines.push(`- matchRate:     ${pct(stats.matchRate)} ${matchOk ? "✅" : "❌"}  (${stats.anchorMatchedOps}/${stats.anchorCountableOps})`);
    lines.push(`- manualPatch:   ${pct(stats.manualPatchRate)} ${manualOk ? "✅" : "❌"}  (${stats.followUpPatchedConfirms}/${stats.totalConfirms}, window=${Math.round(stats.windowMs/60000)}분)`);
    lines.push(`- proposes / confirms / rejects: ${stats.totalProposes} / ${stats.totalConfirms} / ${stats.totalRejects}`);
    lines.push("");
    lines.push("## Hallucination guard — current state");
    lines.push(`- Missing slots (필수 비어있음): ${missingReports.length}개 노드`);
    for (const m of missingReports.slice(0, 5)) lines.push(`  - #${m.nodeId} (${m.title}): ${m.slots.join(", ")}`);
    if (missingReports.length > 5) lines.push(`  - … +${missingReports.length - 5}`);
    lines.push(`- Pending proposals (confirm gate 대기): ${pending.length}건`);
    for (const p of pending.slice(0, 5)) lines.push(`  - ${p.id} by ${p.actor}: ${p.intent}`);
    lines.push(`- meta.rev (낙관락 키): ${store.rev()}`);
    lines.push(`- snapshots: ${store.listSnapshots().length}개 보관`);
    lines.push("");
    lines.push("## Guidance for LLM");
    if (!matchOk) {
      lines.push("- ⚠ matchRate 낮음 — 새 add_node 보다 기존 anchor(#id) 를 update/edge 로 활용 권장.");
    }
    if (!manualOk) {
      lines.push("- ⚠ manualPatchRate 높음 — 한 confirm 안에 가능한 모든 변경 묶기. 빠른 후속 patch 줄일 것.");
    }
    if (missingReports.length > 0) {
      lines.push("- ⚠ Missing slots — 추측으로 채우지 말고 clarify 질문 또는 missing_to_clarify 활용.");
    }
    if (pending.length > 0) {
      lines.push("- 대기 제안이 있음 — confirm 전엔 BP 가 변경되지 않음을 유의. confirm_update 또는 reject_update 호출.");
    }
    if (matchOk && manualOk && missingReports.length === 0) {
      lines.push("- ✅ 모든 환각 통제 축 통과. 계속 anchor 우선 + 슬롯 미충족 시 clarify.");
    }
    return text(lines.join("\n"));
  },
);

server.tool("list_snapshots", "스냅샷 목록(롤백 가능 지점).", {}, async () => {
  const ss = store.listSnapshots();
  if (ss.length === 0) return text("스냅샷 없음.");
  return text(ss.map((s) => `- rev=${s.rev} sha=${s.sha} (${s.file})`).join("\n"));
});

server.tool(
  "restore_snapshot",
  "스냅샷 sha 로 BP 복구(새 rev 로 진행, 이력 보존).",
  { sha: z.string(), actor: z.string().default("user") },
  async ({ sha, actor }) => {
    const r = store.restore(sha, { actor });
    if (!r) return text(`ERROR: 스냅샷 ${sha} 없음.`);
    return text(`복구 완료. newRev=${r.rev}`);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[ubp] MCP server running on stdio (v0.2.0)");
