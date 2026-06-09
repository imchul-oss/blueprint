import { ubpSelf } from "./samples/ubp-self.js";
import { renderTree } from "./core/render-tree.js";
import { detectMissing, missingToClarify } from "./core/missing.js";
import { applyOps, type BlueprintOp } from "./core/ops.js";

console.log("=== /tree ===");
console.log(renderTree(ubpSelf));

console.log("\n=== /missing (검토엔진) ===");
const missing = detectMissing(ubpSelf);
if (missing.length === 0) console.log("결여 0건 — P0 전부 확정");
else {
  for (const c of missingToClarify(missing)) console.log("⚠ " + c);
}

// === 양방향 싱크 시연 ===
// 프롬프트 창에서 "추출 기능은 P2로 미루자" 라고 했다고 가정 →
// 소비 모델이 update_blueprint(ops, intent) 로 되쏨.
console.log("\n=== 싱크: 프롬프트 창 변경 → update_blueprint ===");
const incoming: { ops: BlueprintOp[]; intent: string } = {
  intent: "사용자가 추출 기능을 MVP 범위에서 제외 요청",
  ops: [{ op: "update_node", id: "n_ext", patch: { priority: "P2", status: "deferred" } }],
};
console.log(`intent: ${incoming.intent}`);
console.log("confirm 게이트: 이 변경을 반영할까요? [Y]  (자동머지 금지 원칙)");

const { next, result } = applyOps(ubpSelf, incoming.ops);
console.log(`적용: ${result.applied}건, 거부: ${result.rejected.length}건`);

console.log("\n=== /tree (싱크 후) — n_ext 변경 확인 ===");
console.log(renderTree(next));
