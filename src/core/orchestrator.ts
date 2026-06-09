/**
 * AI Orchestrator — natural-language → BlueprintOp[].
 * Claude(저작 제안)와 Gemini(정책 감사·임팩트)를 분리해 책임을 명확히 한다.
 */
import type { BlueprintOp } from "./ops.js";
import type { NodeRole, BlueprintNode, Blueprint } from "./types.js";
import type { ProjectPolicy } from "./policy.js";
import { blastRadius, type ImpactReport } from "./impact.js";

export interface OrchestratorResult {
  ops: BlueprintOp[];
  intent: string;
  confidence: number;
}

export interface ClaudeOrchestration {
  ops: BlueprintOp[];
  intent: string;
  suggestedRole: NodeRole;
  title: string;
}

export interface GeminiAudit {
  violations: string[];
  recommendations: string[];
  impactReport: ImpactReport;
  policyCompliance: boolean;
}

export interface MultiModelCoordination {
  claude: ClaudeOrchestration;
  gemini: GeminiAudit;
}

/**
 * 1. Claude's Role: Propose implementation structures, features, and attributes.
 */
export function claudeOrchestrate(userInput: string): ClaudeOrchestration {
  const trimmed = userInput.trim();
  
  const roleMap: Record<string, NodeRole> = {
    feature: "feature", 기능: "feature",
    goal: "goal", 목표: "goal",
    persona: "persona", 사용자: "persona",
    metric: "metric", 지표: "metric",
    requirement: "requirement", 요구사항: "requirement",
    screen: "screen", 화면: "screen",
    component: "component", 컴포넌트: "component",
    "data-entity": "data-entity", 데이터: "data-entity"
  };

  // 1) Add Node Matcher
  const addMatch = trimmed.match(/(?:추가|add|create|생성)\s+([\w가-힣-]+)\s*:\s*([^,.\n]+)(?:,\s*(?:우선순위|priority)\s*([\w]+))?(?:,\s*(?:내용|desc)\s*([^,.\n]+))?/i);
  if (addMatch) {
    const rawRole = addMatch[1].toLowerCase().trim();
    const title = addMatch[2].trim();
    const priority = addMatch[3] ? addMatch[3].trim().toUpperCase() as any : undefined;
    const body = addMatch[4] ? addMatch[4].trim() : undefined;
    const role = roleMap[rawRole] || "feature";
    const id = `n_claude_${Math.floor(Math.random() * 9000 + 1000)}`;
    
    const node: BlueprintNode = {
      id,
      role,
      title,
      status: "draft",
      priority,
      body,
      attrs: role === "feature" ? { acceptance_criteria: body || "" } : {}
    };

    return {
      intent: `Claude: 새로운 ${role} 노드 "${title}" 추가 제안`,
      suggestedRole: role,
      title,
      ops: [
        { op: "add_node", node },
        { op: "add_edge", edge: { from: id, to: "n_root", type: "parent" } }
      ]
    };
  }

  // 2) Update Matcher
  const updateMatch = trimmed.match(/(?:변경|수정|change|update|patch)\s+([\w_]+)\s+(?:우선순위|상태|priority|status)(?:를|을)?\s+([\w_]+)/i);
  if (updateMatch) {
    const id = updateMatch[1].trim();
    const val = updateMatch[2].trim();
    const patch: Partial<BlueprintNode> = {};
    if (["P0", "P1", "P2"].includes(val.toUpperCase())) {
      patch.priority = val.toUpperCase() as any;
    } else if (["draft", "confirmed", "stub", "deferred"].includes(val.toLowerCase())) {
      patch.status = val.toLowerCase() as any;
    }

    return {
      intent: `Claude: 노드 ${id} 속성을 "${val}"로 수정 제안`,
      suggestedRole: "feature",
      title: id,
      ops: [{ op: "update_node", id, patch }]
    };
  }

  // 3) Delete Matcher
  const deleteMatch = trimmed.match(/(?:삭제|제거|delete|remove)\s+([\w_]+)/i);
  if (deleteMatch) {
    const id = deleteMatch[1].trim();
    return {
      intent: `Claude: 노드 ${id} 제거 제안`,
      suggestedRole: "feature",
      title: id,
      ops: [{ op: "remove_node", id }]
    };
  }

  // Fallback
  return {
    intent: `Claude: 사용자 지시 분석 중`,
    suggestedRole: "note",
    title: userInput,
    ops: []
  };
}

/**
 * 2. Gemini's Role: Validate proposals against Project Policy, evaluate Blast Radius, and audit compliance.
 */
export function geminiAudit(
  claudeProposal: ClaudeOrchestration,
  bp: Blueprint,
  policy: ProjectPolicy
): GeminiAudit {
  const violations: string[] = [];
  const recommendations: string[] = [];
  
  // Calculate touched IDs to find blast radius
  const changedIds: string[] = [];
  claudeProposal.ops.forEach(op => {
    if (op.op === "add_node") changedIds.push(op.node.id);
    else if (op.op === "update_node" || op.op === "remove_node") changedIds.push(op.id);
  });
  
  const impactReport = blastRadius(bp, changedIds);

  // Validate Node constraints based on BLUEPRINT.md policy
  claudeProposal.ops.forEach(op => {
    if (op.op === "add_node") {
      const node = op.node;
      const reqSlots = policy.requiredSlots[node.role] || [];
      reqSlots.forEach(slot => {
        if (slot === "acceptance_criteria" && (!node.attrs || !node.attrs.acceptance_criteria)) {
          violations.push(`[정책 위반] feature 노드에는 'acceptance_criteria'(수용조건)가 필수적으로 포함되어야 합니다.`);
          recommendations.push(`추천 사항: 노드 상세 폼에 수용조건을 추가하십시오.`);
        }
        if (slot === "priority" && !node.priority) {
          violations.push(`[정책 위반] feature 노드에는 'priority'(우선순위) 슬롯이 필수적입니다.`);
          recommendations.push(`추천 사항: 우선순위를 P0/P1/P2 중 하나로 정의하십시오.`);
        }
      });
      
      // Terminology checking
      for (const [key, replacement] of Object.entries(policy.terminologyRules)) {
        if (node.title.includes(key)) {
          violations.push(`[용어 위배] 타이틀에 금지된 용어 "${key}"가 사용되었습니다.`);
          recommendations.push(`추천 사항: "${key}" 대신 "${replacement}"로 교체하십시오.`);
        }
      }
    }
  });

  const policyCompliance = violations.length === 0;

  return {
    violations,
    recommendations,
    impactReport,
    policyCompliance
  };
}

/**
 * 3. Coordination Runner combining Claude and Gemini
 */
export function coordinateMultiModel(
  userInput: string,
  bp: Blueprint,
  policy: ProjectPolicy
): MultiModelCoordination {
  const claude = claudeOrchestrate(userInput);
  const gemini = geminiAudit(claude, bp, policy);
  return {
    claude,
    gemini
  };
}

// Keep the legacy orchestrate signature intact to ensure backwards compatibility with mcp-server.ts or tests
export function orchestrate(userInput: string, parentNodeId = "n_root"): { ops: BlueprintOp[]; intent: string; confidence: number } {
  const claude = claudeOrchestrate(userInput);
  return {
    ops: claude.ops,
    intent: claude.intent,
    confidence: claude.ops.length > 0 ? 0.9 : 0.3
  };
}

