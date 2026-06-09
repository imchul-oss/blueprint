import type { BlueprintOp } from "./ops.js";

/**
 * Conflict 검출.
 *
 * 두 개 이상의 propose 가 같은 anchor(노드 id 또는 attr 경로)를 동시에 변경하려 할 때
 * 사람이 한쪽을 선택하거나 머지하도록 표면화한다.
 *
 * Anchor 단위:
 *   - 노드 단위: `#nodeId`         (update_node, remove_node, add_edge/remove_edge 끝점)
 *   - 속성 단위: `#nodeId.attrs.X` (update_node.patch.attrs[X])
 *   - 노드 자체 필드: `#nodeId.<field>` (update_node.patch.<field>)
 *
 * 동일 anchor 를 만지는 propose 쌍을 모두 반환한다(쌍 단위, 순서 무관).
 */

export interface ConflictProposalLike {
  id: string;
  intent: string;
  ops: BlueprintOp[];
  actor: string;
  baseRev: number;
}

export interface AnchorRef {
  /** 정규화된 anchor 문자열. 예: `#n_a`, `#n_a.attrs.priority`, `#n_a.title` */
  key: string;
  /** 가공 안 한 nodeId */
  nodeId: string;
  /** 노드 자체 anchor 면 빈 문자열, 속성이면 path */
  path: string;
}

export interface ConflictPair {
  anchor: AnchorRef;
  proposals: [ConflictProposalLike, ConflictProposalLike];
}

function anchorsOf(op: BlueprintOp): AnchorRef[] {
  if (op.op === "add_node") return [{ key: `#${op.node.id}`, nodeId: op.node.id, path: "" }];
  if (op.op === "remove_node") return [{ key: `#${op.id}`, nodeId: op.id, path: "" }];
  if (op.op === "update_node") {
    const out: AnchorRef[] = [];
    for (const k of Object.keys(op.patch)) {
      if (k === "attrs" && op.patch.attrs) {
        for (const ak of Object.keys(op.patch.attrs))
          out.push({ key: `#${op.id}.attrs.${ak}`, nodeId: op.id, path: `attrs.${ak}` });
      } else {
        out.push({ key: `#${op.id}.${k}`, nodeId: op.id, path: k });
      }
    }
    // patch 가 비면 노드 자체 anchor 로 본다
    if (out.length === 0) out.push({ key: `#${op.id}`, nodeId: op.id, path: "" });
    return out;
  }
  if (op.op === "add_edge" || op.op === "remove_edge") {
    return [
      { key: `#${op.edge.from}~edge~${op.edge.type}~${op.edge.to}`, nodeId: op.edge.from, path: `edge:${op.edge.type}:${op.edge.to}` },
    ];
  }
  return [];
}

export function findConflicts(pending: ConflictProposalLike[]): ConflictPair[] {
  // anchor -> proposal ids
  const map = new Map<string, { ref: AnchorRef; ids: Set<string> }>();
  const byId = new Map<string, ConflictProposalLike>();

  for (const p of pending) {
    byId.set(p.id, p);
    for (const op of p.ops) {
      for (const a of anchorsOf(op)) {
        const slot = map.get(a.key) ?? { ref: a, ids: new Set<string>() };
        slot.ids.add(p.id);
        map.set(a.key, slot);
      }
    }
  }

  const pairs: ConflictPair[] = [];
  const seenPairs = new Set<string>();

  for (const { ref, ids } of map.values()) {
    if (ids.size < 2) continue;
    const arr = [...ids];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i],
          b = arr[j];
        const pairKey = `${[a, b].sort().join("|")}::${ref.key}`;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        const pa = byId.get(a);
        const pb = byId.get(b);
        if (!pa || !pb) continue;
        pairs.push({ anchor: ref, proposals: [pa, pb] });
      }
    }
  }
  return pairs;
}

export function formatConflicts(pairs: ConflictPair[]): string {
  if (pairs.length === 0) return "충돌 0건.";
  return pairs
    .map(
      (p) =>
        `[anchor=${p.anchor.key}]\n  - ${p.proposals[0].id} (actor=${p.proposals[0].actor}) "${p.proposals[0].intent}"\n  - ${p.proposals[1].id} (actor=${p.proposals[1].actor}) "${p.proposals[1].intent}"`,
    )
    .join("\n\n");
}
