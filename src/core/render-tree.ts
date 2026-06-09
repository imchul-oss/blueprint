import type { Blueprint, BlueprintNode } from "./types.js";

const STATUS_MARK: Record<string, string> = {
  confirmed: "✓",
  draft: "draft",
  stub: "stub",
  deferred: "deferred",
};

/**
 * 채팅에서 흉내냈던 /tree 뷰의 실제 구현.
 * parent 엣지를 따라 계층을 그리고, 상태·우선순위·결여를 표기.
 */
export function renderTree(bp: Blueprint): string {
  const childrenOf = (id: string) =>
    bp.edges
      .filter((e) => e.type === "parent" && e.to === id)
      .map((e) => bp.nodes.find((n) => n.id === e.from))
      .filter((n): n is BlueprintNode => !!n);

  const line = (n: BlueprintNode) => {
    const parts = [`[${n.role}]`, n.title];
    if (n.priority) parts.push(n.priority);
    parts.push(`#${n.id}`);
    if (n.status !== "confirmed") parts.push(STATUS_MARK[n.status] ?? n.status);
    else parts.push("✓");
    if (n.missing?.length) parts.push(`⚠missing:${n.missing.join(",")}`);
    return parts.join(" ");
  };

  const out: string[] = [`● ${bp.meta.title}  ${bp.meta.version}`];
  const walk = (id: string, depth: number) => {
    for (const child of childrenOf(id)) {
      out.push("  ".repeat(depth) + "├─ " + line(child));
      walk(child.id, depth + 1);
    }
  };
  walk("n_root", 0);
  return out.join("\n");
}
