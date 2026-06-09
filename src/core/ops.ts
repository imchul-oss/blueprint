import type { Blueprint, BlueprintNode, BlueprintEdge } from "./types.js";

/**
 * BlueprintOp — 블루프린트에 대한 원자적 변경.
 * 양방향 싱크의 공통 언어: 소비 모델이 update_blueprint(ops) 로 되쏘는 것도,
 * 에디터에서 /add /edit 하는 것도 전부 ops 로 환원된다.
 */
export type BlueprintOp =
  | { op: "add_node"; node: BlueprintNode }
  | { op: "update_node"; id: string; patch: Partial<Omit<BlueprintNode, "id">> }
  | { op: "remove_node"; id: string }
  | { op: "add_edge"; edge: BlueprintEdge }
  | { op: "remove_edge"; edge: BlueprintEdge };

export interface OpResult {
  ok: boolean;
  /** 적용된 op 수 */
  applied: number;
  /** 거부된 op 와 사유 (예: 존재하지 않는 노드 수정) */
  rejected: { op: BlueprintOp; reason: string }[];
}

const clone = (bp: Blueprint): Blueprint => structuredClone(bp);

/**
 * ops 를 블루프린트에 적용. 순수 함수 — 새 블루프린트를 반환한다.
 * 자동 머지가 아니라, 호출자가 confirm 게이트를 통과시킨 뒤 호출하는 것을 전제.
 */
export function applyOps(
  bp: Blueprint,
  ops: BlueprintOp[],
): { next: Blueprint; result: OpResult } {
  const next = clone(bp);
  const rejected: OpResult["rejected"] = [];
  let applied = 0;

  const findNode = (id: string) => next.nodes.find((n) => n.id === id);

  for (const op of ops) {
    switch (op.op) {
      case "add_node": {
        if (findNode(op.node.id)) {
          rejected.push({ op, reason: `중복 노드 id: ${op.node.id}` });
          continue;
        }
        next.nodes.push(op.node);
        applied++;
        break;
      }
      case "update_node": {
        const n = findNode(op.id);
        if (!n) {
          rejected.push({ op, reason: `노드 없음: ${op.id}` });
          continue;
        }
        Object.assign(n, op.patch);
        if (op.patch.attrs) n.attrs = { ...n.attrs, ...op.patch.attrs };
        applied++;
        break;
      }
      case "remove_node": {
        const idx = next.nodes.findIndex((n) => n.id === op.id);
        if (idx < 0) {
          rejected.push({ op, reason: `노드 없음: ${op.id}` });
          continue;
        }
        next.nodes.splice(idx, 1);
        // 매달린 엣지 정리
        next.edges = next.edges.filter((e) => e.from !== op.id && e.to !== op.id);
        applied++;
        break;
      }
      case "add_edge": {
        if (!findNode(op.edge.from) || !findNode(op.edge.to)) {
          rejected.push({ op, reason: `엣지 끝점 노드 없음` });
          continue;
        }
        next.edges.push(op.edge);
        applied++;
        break;
      }
      case "remove_edge": {
        const before = next.edges.length;
        next.edges = next.edges.filter(
          (e) =>
            !(e.from === op.edge.from && e.to === op.edge.to && e.type === op.edge.type),
        );
        if (next.edges.length === before) {
          rejected.push({ op, reason: `엣지 없음` });
          continue;
        }
        applied++;
        break;
      }
    }
  }

  return { next, result: { ok: rejected.length === 0, applied, rejected } };
}
