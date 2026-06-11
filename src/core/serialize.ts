import type { Blueprint } from "./types.js";
import { detectMissing } from "./missing.js";

/**
 * 직렬화 포맷(n_fmt): 소비 모델이 읽기 좋은 형태.
 * JSON(기계 정확) + 자연어 요약(LLM 친화) 병행, anchor 안내 포함.
 * delta 모드는 변경분만 전달(토큰 효율) — 여기선 full/summary 제공, delta 는 ops 로 대체.
 */
export interface SerializedBlueprint {
  json: Blueprint;
  summary: string;
  anchors: string[];
}

/**
 * 서빙 프로파일 — 산출물 렌더는 모델에 위임(불변)하되, "어떻게 서빙할지"는 UBP 책임.
 * 타깃별로 주목할 슬롯과 렌더 지침을 바꿔 모델의 첫 해석 비용을 줄인다.
 */
export type ServeTarget = "prd" | "deck" | "code" | "policy";
const TARGET_PROFILES: Record<ServeTarget, { label: string; focus: string; guide: string }> = {
  prd: {
    label: "PRD",
    focus: "feature.acceptance_criteria · feature.priority · metric · persona",
    guide: "기능 단위로 섹션화하고 acceptance_criteria 를 명시적 수용 기준으로 표기. priority 순 정렬.",
  },
  deck: {
    label: "발표 덱",
    focus: "goal · claim · metric · supports 엣지",
    guide: "goal→claim→근거(supports) 흐름을 슬라이드 골격으로. 노드당 1슬라이드 기본, body 는 발표 노트로.",
  },
  code: {
    label: "코드",
    focus: "data-entity.fields · component · depends-on 엣지 · anchor",
    guide: "entity 필드를 타입/스키마로, depends-on 을 모듈 의존으로. 생성 코드엔 @ubp-anchor: #id 주석을 심어 추적성 유지.",
  },
  policy: {
    label: "정책/하네스 문서",
    focus: "requirement · claim · supports 엣지 · terminology",
    guide: "requirement·claim 을 규칙 조항으로 번호 매기고, supports 엣지를 근거 각주로. 금지/허용을 명시적 대구로.",
  },
};

export function serializeForModel(
  bp: Blueprint,
  opts: { target?: ServeTarget } = {},
): SerializedBlueprint {
  const missing = detectMissing(bp);
  const missingById = new Map(missing.map((m) => [m.nodeId, m.slots]));
  const profile = opts.target ? TARGET_PROFILES[opts.target] : undefined;

  const lines: string[] = [`# 블루프린트: ${bp.meta.title} (${bp.meta.id} v${bp.meta.version})`];
  if (profile) {
    lines.push(`\n[서빙 프로파일: ${profile.label}] 주목 슬롯 — ${profile.focus}`);
  }
  lines.push("\n## 노드 (anchor = #id, 속성은 #id.attrs.<키>)");
  for (const n of bp.nodes) {
    const tags = [n.role, n.priority, n.status].filter(Boolean).join("/");
    const miss = missingById.get(n.id);
    lines.push(`- #${n.id} [${tags}] ${n.title}${miss ? ` ⚠미정:${miss.join(",")}` : ""}`);
    if (n.body) lines.push(`    └ ${n.body}`);
    if (n.attrs)
      for (const [k, v] of Object.entries(n.attrs))
        lines.push(`    └ ${k}: ${JSON.stringify(v)}  (anchor: #${n.id}.attrs.${k})`);
  }
  lines.push("\n## 관계");
  for (const e of bp.edges) lines.push(`- ${e.from} -${e.type}-> ${e.to}`);
  lines.push(
    "\n## 렌더 지침\n" +
      (profile
        ? `- 이 블루프린트를 ${profile.label} 형식으로 렌더하라. ${profile.guide}\n`
        : "- 이 블루프린트를 요청 형식(PRD/PPT/코드 등)으로 렌더하라.\n") +
      "- 의미 변경 시 update_blueprint(ops, intent)로 되쏘되, anchor(#id 또는 #id.attrs.키)를 명시하라.\n- 블루프린트에 기재된 값만 싱크 대상이다(기재 여부 = granularity 기준).",
  );

  const anchors = bp.nodes.flatMap((n) => [
    `#${n.id}`,
    ...Object.keys(n.attrs ?? {}).map((k) => `#${n.id}.attrs.${k}`),
  ]);

  return { json: bp, summary: lines.join("\n"), anchors };
}
