import type { Blueprint, BlueprintNode, BlueprintEdge, NodeRole } from "./types.js";

/**
 * Parses unstructured markdown or text and extracts nodes and edges for a Blueprint.
 */
export function extractBlueprintFromText(text: string): Omit<Blueprint, "meta"> {
  const nodes: BlueprintNode[] = [];
  const edges: BlueprintEdge[] = [];
  let seq = 0;
  
  const lines = text.split(/\r?\n/);
  
  // Track headings to establish parent-child hierarchies
  const headingStack: { id: string; level: number }[] = [];
  
  // Create a root product node if one isn't explicitly defined
  const rootId = "n_extracted_root";
  nodes.push({
    id: rootId,
    role: "product",
    title: "Extracted Product Blueprint",
    status: "draft"
  });
  headingStack.push({ id: rootId, level: 0 });

  const roleMap: Record<string, NodeRole> = {
    목표: "goal", goal: "goal",
    사용자: "persona", 페르소나: "persona", persona: "persona",
    지표: "metric", metric: "metric",
    요구사항: "requirement", requirement: "requirement",
    기능: "feature", feature: "feature",
    화면: "screen", screen: "screen",
    구성요소: "screen-element", element: "screen-element",
    컴포넌트: "component", component: "component",
    데이터: "data-entity", 엔티티: "data-entity", entity: "data-entity",
    주장: "claim", claim: "claim",
    메모: "note", note: "note"
  };

  const getCleanText = (s: string) => s.trim().replace(/^[-*+]\s*/, "").trim();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Handle Headings (e.g., # Product Title or ## Feature Area)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      const id = `n_h_${++seq}`;
      
      // Determine role based on title keywords or default to section/feature
      let role: NodeRole = "section";
      for (const [kw, r] of Object.entries(roleMap)) {
        if (title.toLowerCase().includes(kw)) {
          role = r;
          break;
        }
      }

      nodes.push({
        id,
        role,
        title,
        status: "draft"
      });

      // Maintain tree hierarchy
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      
      const parent = headingStack[headingStack.length - 1];
      if (parent) {
        edges.push({ from: id, to: parent.id, type: "parent" });
      }
      
      headingStack.push({ id, level });
      continue;
    }

    // Handle List Items (e.g. - [feature] Login Screen: Allow user to authenticate)
    const listMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    if (listMatch) {
      const itemContent = listMatch[1].trim();
      const bracketMatch = itemContent.match(/^\[([^\]]+)\]\s*(.+)$/);
      
      let role: NodeRole = "feature";
      let content = itemContent;
      
      if (bracketMatch) {
        const rawRole = bracketMatch[1].toLowerCase().trim();
        role = roleMap[rawRole] || "feature";
        content = bracketMatch[2];
      } else {
        // Keyword detection in line
        for (const [kw, r] of Object.entries(roleMap)) {
          if (itemContent.toLowerCase().startsWith(kw + ":") || itemContent.toLowerCase().startsWith(kw + " :")) {
            role = r;
            content = itemContent.substring(kw.length + 1).trim();
            break;
          }
        }
      }

      // Split content into title and description if separated by ":"
      const colonIndex = content.indexOf(":");
      let title = content;
      let body = undefined;
      let attrs: Record<string, any> = {};

      if (colonIndex > 0) {
        title = content.substring(0, colonIndex).trim();
        body = content.substring(colonIndex + 1).trim();
        
        if (role === "feature") {
          attrs.acceptance_criteria = body;
        } else if (role === "data-entity") {
          attrs.fields = body.split(",").map(f => f.trim());
        }
      }

      const id = `n_item_${++seq}`;
      const node: BlueprintNode = {
        id,
        role,
        title,
        status: "draft"
      };
      if (body) {
        node.body = body;
      }
      if (Object.keys(attrs).length > 0) {
        node.attrs = attrs;
      }
      
      nodes.push(node);

      // Parent is the current active heading
      const parent = headingStack[headingStack.length - 1];
      if (parent) {
        edges.push({ from: id, to: parent.id, type: "parent" });
      }
    }
  }

  return { nodes, edges };
}
