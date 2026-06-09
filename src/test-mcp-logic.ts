/**
 * MCP 서버가 의존하는 로직(store propose/confirm + serialize + impact)을
 * SDK 없이 직접 검증한다. (stdio 서버 e2e 전 단위 검증)
 */
import { BlueprintStore } from "./store.js";
import { serializeForModel } from "./core/serialize.js";
import type { BlueprintOp } from "./core/ops.js";
import { ubpSelf } from "./samples/ubp-self.js";

let pass = 0,
  fail = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  cond ? pass++ : fail++;
};

const store = new BlueprintStore(structuredClone(ubpSelf)); // 메모리만(경로 없음)

// 1) 직렬화에 anchor 가 포함되는가
const ser = serializeForModel(store.get());
check("serialize: anchor에 속성 경로 포함", ser.anchors.includes("#n_ed.attrs.acceptance_criteria"));
check("serialize: 요약에 렌더 지침 포함", ser.summary.includes("update_blueprint"));

// 2) confirm 게이트: propose 는 반영하지 않는다
const ops: BlueprintOp[] = [
  { op: "update_node", id: "n_ext", patch: { priority: "P2", status: "deferred" } },
];
const proposal = store.propose(ops, "추출 기능 MVP 제외");
const stillP1 = store.get().nodes.find((n) => n.id === "n_ext")?.priority === "P1";
check("propose: 즉시 반영 안 함(confirm 전)", stillP1);
check("propose: 영향도 등급 산출됨", ["국소", "중간", "광범위"].includes(proposal.impact.level));

// 3) confirm: 승인 시 반영
const res = store.confirm(proposal.id);
const nowP2 = store.get().nodes.find((n) => n.id === "n_ext")?.priority === "P2";
check("confirm: 승인 후 반영됨", !!res && nowP2);

// 4) confirm 게이트: 존재하지 않는 제안은 거부
check("confirm: 만료/없는 제안 거부", store.confirm("p_none") === null);

// 5) add_edge 검증: 없는 노드면 거부
const bad = store.propose([{ op: "add_edge", edge: { from: "n_root", to: "n_ghost", type: "parent" } }], "잘못된 엣지");
const r2 = store.confirm(bad.id);
check("ops: 끝점 없는 엣지 거부", !!r2 && r2.result.rejected.length === 1);

console.log(`\n결과: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
