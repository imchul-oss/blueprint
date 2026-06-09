import type { AuditEntry } from "../store.js";
import type { BlueprintOp } from "./ops.js";

/**
 * 정합률(anchor 매칭 성공률)과 수동 보정율(confirm 후 같은 노드를 짧은 시간 내 patch한 비율)을
 * audit.jsonl 기록으로부터 자동 계산한다. n_metric 의 측정 정의 구현.
 *
 * 정의:
 *   - matchRate = (anchor 매칭 ops) / (총 ops)
 *     anchor 매칭: 기존 노드를 가리키는 update_node / remove_node / remove_edge / add_edge(끝점이 이미 존재)
 *     비매칭: add_node (새 anchor 도입은 매칭 아님), add_edge(끝점 미존재 — 이 경우 자체가 거부됨)
 *   - manualPatchRate = confirm 후 windowMs 안에 같은 노드를 다시 patch 한 비율
 */

export interface ComplianceStats {
  totalProposes: number;
  totalConfirms: number;
  totalRejects: number;
  /** 0~1. NaN 이면 통계 산출 불가(분모 0). */
  matchRate: number;
  /** 0~1. */
  manualPatchRate: number;
  /** 정의 시 사용한 윈도우. */
  windowMs: number;
  /** confirm 으로 들어간 op 개수(add_node 포함). */
  confirmedOps: number;
  /** add_node 제외한 anchor-countable op 개수. matchRate 분모. */
  anchorCountableOps: number;
  /** anchor 매칭된 op 개수. matchRate 분자. */
  anchorMatchedOps: number;
  /** confirm 이후 동일 노드 재패치된 confirm 개수. */
  followUpPatchedConfirms: number;
}

/** entry 가 confirm 이며 ops 가 있는 경우 노드 id 집합 반환. */
function nodesTouchedBy(entry: AuditEntry): string[] {
  const ids = new Set<string>();
  if (!entry.ops) return [];
  for (const op of entry.ops) {
    if (op.op === "add_node") ids.add(op.node.id);
    else if (op.op === "update_node" || op.op === "remove_node") ids.add(op.id);
    else if (op.op === "add_edge" || op.op === "remove_edge") {
      ids.add(op.edge.from);
      ids.add(op.edge.to);
    }
  }
  return [...ids];
}

function isAnchorMatched(op: BlueprintOp, knownIds: Set<string>): boolean {
  if (op.op === "update_node") return knownIds.has(op.id);
  if (op.op === "remove_node") return knownIds.has(op.id);
  if (op.op === "remove_edge") return knownIds.has(op.edge.from) && knownIds.has(op.edge.to);
  if (op.op === "add_edge") return knownIds.has(op.edge.from) && knownIds.has(op.edge.to);
  // add_node 는 새 anchor 도입 — 매칭 카운트에 포함하지 않음(분모도 분자도 아님)
  return false;
}

function isAnchorCountable(op: BlueprintOp): boolean {
  // add_node 는 매칭 통계 분모에서 제외 — "anchor 생성"이므로 매칭 개념과 별개
  return op.op !== "add_node";
}

export function computeCompliance(
  audit: AuditEntry[],
  windowMs = 5 * 60 * 1000,
): ComplianceStats {
  let totalProposes = 0,
    totalConfirms = 0,
    totalRejects = 0;
  let confirmedOps = 0;
  let anchorMatched = 0;
  let anchorCountable = 0;

  // 노드가 처음 add_node 로 등장한 confirm 시점 기준으로 known 집합 누적
  const known = new Set<string>();

  // confirm 만 시간순으로 다시 정렬해 노드별 마지막 confirm 시각 추적
  const confirms = audit.filter((e) => e.kind === "confirm").sort((a, b) => a.ts - b.ts);
  const lastConfirmOnNode = new Map<string, number>();
  let followUpPatched = 0;

  for (const e of audit) {
    if (e.kind === "propose") totalProposes++;
    else if (e.kind === "reject") totalRejects++;
    else if (e.kind === "confirm") {
      totalConfirms++;
      if (!e.ops) continue;
      for (const op of e.ops) {
        confirmedOps++;
        if (isAnchorCountable(op)) {
          anchorCountable++;
          if (isAnchorMatched(op, known)) anchorMatched++;
        }
        // known 갱신
        if (op.op === "add_node") known.add(op.node.id);
        else if (op.op === "remove_node") known.delete(op.id);
      }
    }
  }

  // followUpPatchedConfirms: 한 노드에 대해 직전 confirm 이후 windowMs 안에 update_node 패치가 또 들어온 confirm 개수
  // (즉, 즉시 보정한 케이스만 보정으로 간주)
  for (const e of confirms) {
    if (!e.ops) continue;
    const touched = nodesTouchedBy(e);
    let counted = false;
    for (const id of touched) {
      const prev = lastConfirmOnNode.get(id);
      if (prev != null && e.ts - prev <= windowMs) {
        // 이 confirm 이 직전 confirm 의 후속 보정인지 확인 — update_node 가 있어야 보정 카운트
        const hasPatch = e.ops.some((op) => op.op === "update_node" && op.id === id);
        if (hasPatch && !counted) {
          followUpPatched++;
          counted = true;
        }
      }
      lastConfirmOnNode.set(id, e.ts);
    }
  }

  const matchRate = anchorCountable === 0 ? Number.NaN : anchorMatched / anchorCountable;
  const manualPatchRate = totalConfirms === 0 ? 0 : followUpPatched / totalConfirms;

  return {
    totalProposes,
    totalConfirms,
    totalRejects,
    matchRate,
    manualPatchRate,
    windowMs,
    confirmedOps,
    anchorCountableOps: anchorCountable,
    anchorMatchedOps: anchorMatched,
    followUpPatchedConfirms: followUpPatched,
  };
}

export function formatCompliance(s: ComplianceStats): string {
  const pct = (x: number) => (Number.isNaN(x) ? "—" : (x * 100).toFixed(1) + "%");
  return [
    `[Compliance · audit 기반]`,
    `propose=${s.totalProposes}, confirm=${s.totalConfirms}, reject=${s.totalRejects}`,
    `정합률(matchRate)     = ${pct(s.matchRate)}  (${s.anchorMatchedOps}/${s.anchorCountableOps})`,
    `수동보정율(manualPatch) = ${pct(s.manualPatchRate)}  (${s.followUpPatchedConfirms}/${s.totalConfirms}, window=${Math.round(s.windowMs / 60000)}분)`,
    `목표: 정합률 >= 90%, 수동보정율 < 20%`,
  ].join("\n");
}
