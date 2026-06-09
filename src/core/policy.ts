import { readFileSync, existsSync } from "node:fs";
import type { NodeRole } from "./types.js";

export interface ProjectPolicy {
  trackableAttributes: string[];
  requiredSlots: Record<NodeRole, string[]>;
  blastRadiusThresholds: {
    critical: number;
    warning: number;
  };
  terminologyRules: Record<string, string>;
}

const DEFAULT_POLICY: ProjectPolicy = {
  trackableAttributes: ["title", "status", "priority", "attrs.acceptance_criteria", "attrs.fields"],
  requiredSlots: {
    product: [],
    goal: [],
    persona: [],
    metric: ["definition"],
    requirement: [],
    feature: ["acceptance_criteria", "priority"],
    flow: [],
    "flow-step": [],
    screen: ["screen-element>=1"],
    "screen-element": [],
    component: [],
    "data-entity": ["fields"],
    section: [],
    claim: ["supports-edge>=1"],
    note: []
  },
  blastRadiusThresholds: {
    critical: 5,
    warning: 2
  },
  terminologyRules: {}
};

/**
 * Parses a BLUEPRINT.md markdown file to extract project policy configuration.
 */
export function parsePolicy(content: string): ProjectPolicy {
  const policy: ProjectPolicy = JSON.parse(JSON.stringify(DEFAULT_POLICY));
  
  let currentSection = "";
  const lines = content.split(/\r?\n/);
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (trimmed.startsWith("##")) {
      currentSection = trimmed.replace(/^##\s*/, "").toLowerCase();
      continue;
    }
    
    if (currentSection.includes("trackable attributes") || currentSection.includes("추적 속성")) {
      const match = trimmed.match(/^-\s*`?([\w.]+)`?/);
      if (match) {
        if (!policy.trackableAttributes.includes(match[1])) {
          policy.trackableAttributes.push(match[1]);
        }
      }
    } else if (currentSection.includes("required slots") || currentSection.includes("필수 슬롯")) {
      const match = trimmed.match(/^-\s*`?([\w-]+)`?\s*:\s*\[([^\]]+)\]/);
      if (match) {
        const role = match[1] as NodeRole;
        const slots = match[2].split(",").map(s => s.trim().replace(/['"`]/g, ""));
        policy.requiredSlots[role] = slots;
      }
    } else if (currentSection.includes("blast radius") || currentSection.includes("영향도 임계치")) {
      const matchCrit = trimmed.match(/critical\s*[:=]\s*(\d+)/i);
      const matchWarn = trimmed.match(/warning\s*[:=]\s*(\d+)/i);
      if (matchCrit) policy.blastRadiusThresholds.critical = parseInt(matchCrit[1], 10);
      if (matchWarn) policy.blastRadiusThresholds.warning = parseInt(matchWarn[1], 10);
    } else if (currentSection.includes("terminology") || currentSection.includes("용어 규칙")) {
      const match = trimmed.match(/^-\s*`?([^`:]+)`?\s*->\s*`?([^`]+)`?/);
      if (match) {
        policy.terminologyRules[match[1].trim()] = match[2].trim();
      }
    }
  }
  
  return policy;
}

export function loadPolicy(filePath: string): ProjectPolicy {
  if (!existsSync(filePath)) {
    return DEFAULT_POLICY;
  }
  try {
    const content = readFileSync(filePath, "utf8");
    return parsePolicy(content);
  } catch (e) {
    console.error(`[policy] Failed to load policy file ${filePath}: ${(e as Error).message}`);
    return DEFAULT_POLICY;
  }
}
