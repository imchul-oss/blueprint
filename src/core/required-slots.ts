import type { NodeRole, BlueprintNode, Blueprint } from "./types.js";

/**
 * role 별 필수 슬롯 정의 — 검토엔진(missing/clarify)의 근거.
 * Manyfast 대비 차별점이자 환각 통제 장치:
 * 비면 AI가 추측으로 채우지 않고 missing 으로 표면화한다.
 *
 * 각 규칙은 (node, blueprint) => 충족 여부.
 * attr 슬롯과 edge 슬롯을 모두 표현하기 위해 함수형으로 둔다.
 */
export interface SlotRule {
  slot: string;
  satisfied: (node: BlueprintNode, bp: Blueprint) => boolean;
}

const hasAttr = (key: string): SlotRule => ({
  slot: key,
  satisfied: (n) => n.attrs?.[key] != null && n.attrs[key] !== "",
});

const hasChildOfRole = (role: NodeRole, slot: string): SlotRule => ({
  slot,
  satisfied: (n, bp) =>
    bp.edges.some(
      (e) =>
        e.type === "parent" &&
        e.to === n.id &&
        bp.nodes.find((x) => x.id === e.from)?.role === role,
    ),
});

const hasOutgoingEdge = (type: string, slot: string): SlotRule => ({
  slot,
  satisfied: (n, bp) => bp.edges.some((e) => e.from === n.id && e.type === (type as any)),
});

export const REQUIRED_SLOTS: Partial<Record<NodeRole, SlotRule[]>> = {
  feature: [hasAttr("acceptance_criteria"), { slot: "priority", satisfied: (n) => !!n.priority }],
  "data-entity": [hasAttr("fields")],
  screen: [hasChildOfRole("screen-element", "screen-element>=1")],
  // 근거 없는 주장 차단: claim 은 supports 엣지가 최소 1개 있어야 함
  claim: [hasOutgoingEdge("supports", "supports-edge>=1")],
  metric: [{ slot: "definition", satisfied: (n) => !!n.body || !!n.title }],
};
