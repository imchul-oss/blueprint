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

export function serializeForModel(bp: Blueprint): SerializedBlueprint {
  const missing = detectMissing(bp);
  const missingById = new Map(missing.map((m) => [m.nodeId, m.slots]));

  const lines: string[] = [`# 블루프린트: ${bp.meta.title} (${bp.meta.id} v${bp.meta.version})`];
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
    "\n## 렌더 지침\n- 이 블루프린트를 요청 형식(PRD/PPT/코드 등)으로 렌더하라.\n- 의미 변경 시 update_blueprint(ops, intent)로 되쏘되, anchor(#id 또는 #id.attrs.키)를 명시하라.\n- 블루프린트에 기재된 값만 싱크 대상이다(기재 여부 = granularity 기준).",
  );

  const anchors = bp.nodes.flatMap((n) => [
    `#${n.id}`,
    ...Object.keys(n.attrs ?? {}).map((k) => `#${n.id}.attrs.${k}`),
  ]);

  return { json: bp, summary: lines.join("\n"), anchors };
}
