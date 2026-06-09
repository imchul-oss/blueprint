import type { Blueprint } from "./types.js";

export type ImpactLevel = "국소" | "중간" | "광범위";

export interface ImpactReport {
  changed: string[];
  /** 변경에서 파급되는 노드 id (changed 제외) */
  affected: string[];
  affectedTitles: string[];
  level: ImpactLevel;
}

/**
 * 영향도(blast radius) — 결정적 부분.
 * 변경된 노드에서 엣지 타입을 고려한 방향성 그래프를 따라 파급 범위를 계산한다.
 * 의미 단위 파급 규칙:
 * - depends-on: 피의존성(to) 변경 시 의존하는 노드(from)로 전파
 * - parent: 부모(to) 변경 시 자식(from)으로 전파, 자식 변경 시 부모로 전파 (양방향)
 * - realizes: 요구사항(to) 변경 시 이를 구현하는 기능(from)으로 전파
 * - supports: 근거(from) 변경 시 이를 뒷받침하는 목표/지표(to)로 전파
 * - flows-to: 이전 단계(from) 변경 시 다음 단계(to)로 전파
 * - renders-on: 화면(to) 변경 시 화면 요소(from)로 전파
 * - traces-to: 양방향 전파 (추적성)
 */
export function blastRadius(bp: Blueprint, changed: string[], depth = 3): ImpactReport {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };

  // 방향성 영향 전파 맵 구축
  for (const e of bp.edges) {
    if (e.type === "depends-on") {
      link(e.to, e.from); // 룰: 피의존 노드가 변하면 의존 노드들이 영향 받음
    } else if (e.type === "parent") {
      link(e.to, e.from); // 부모 노드가 변하면 자식 노드가 영향 받음
      link(e.from, e.to); // 자식 노드가 변해도 부모 영역 전체가 영향 받음
    } else if (e.type === "realizes") {
      link(e.to, e.from); // 요구사항이 변하면 실현하는 기능이 영향 받음
    } else if (e.type === "supports") {
      link(e.from, e.to); // 근거 노드가 변하면 목표/지표가 영향 받음
    } else if (e.type === "flows-to") {
      link(e.from, e.to); // 앞 단계가 변하면 뒷 단계가 영향 받음
    } else if (e.type === "renders-on") {
      link(e.to, e.from); // 화면이 변하면 구성 요소가 영향 받음
    } else if (e.type === "traces-to") {
      link(e.from, e.to); // 양방향 동기화 추적선
      link(e.to, e.from);
    }
  }

  const seen = new Set(changed);
  let frontier = [...changed];
  for (let d = 0; d < depth; d++) {
    const nextF: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          nextF.push(nb);
        }
      }
    }
    frontier = nextF;
  }

  const affected = [...seen].filter((id) => !changed.includes(id));
  const titleOf = (id: string) => bp.nodes.find((n) => n.id === id)?.title ?? id;
  
  // 가중치에 따른 영향 수준 등급화
  const level: ImpactLevel = affected.length <= 1 ? "국소" : affected.length <= 4 ? "중간" : "광범위";

  return { changed, affected, affectedTitles: affected.map(titleOf), level };
}
