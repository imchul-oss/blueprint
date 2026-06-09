import type { Blueprint } from "./types.js";
import { REQUIRED_SLOTS } from "./required-slots.js";

export interface MissingReport {
  nodeId: string;
  title: string;
  slots: string[];
}

/**
 * 검토엔진 핵심: role 별 필수 슬롯이 비어있는 노드를 찾아낸다.
 * AI 가 추측으로 채우지 않고, 여기서 표면화 → clarify 질문으로 이어진다.
 */
export function detectMissing(bp: Blueprint): MissingReport[] {
  const reports: MissingReport[] = [];
  for (const node of bp.nodes) {
    const rules = REQUIRED_SLOTS[node.role];
    if (!rules) continue;
    const missingSlots = rules.filter((r) => !r.satisfied(node, bp)).map((r) => r.slot);
    if (missingSlots.length > 0) {
      reports.push({ nodeId: node.id, title: node.title, slots: missingSlots });
    }
  }
  return reports;
}

/** 결여 슬롯을 사람이 읽는 clarify 질문 후보로 변환(저작보조에 공급). */
export function missingToClarify(reports: MissingReport[]): string[] {
  return reports.map(
    (r) => `'${r.title}'(#${r.nodeId})에 ${r.slots.join(", ")} 가(이) 비어 있습니다. 어떻게 정할까요?`,
  );
}
