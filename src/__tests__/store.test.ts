import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlueprintStore } from "../store.js";
import type { Blueprint } from "../core/types.js";

const seed: Blueprint = {
  meta: { id: "bp", title: "Test", version: "0.1", rev: 1 },
  nodes: [
    { id: "n_root", role: "product", title: "root", status: "confirmed" },
    { id: "n_a", role: "feature", title: "A", status: "draft", priority: "P0", attrs: { acceptance_criteria: "AC" } },
  ],
  edges: [{ from: "n_a", to: "n_root", type: "parent" }],
};

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "ubp-test-"));
}

describe("BlueprintStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = freshDir();
  });

  it("propose 는 BP 를 변경하지 않는다 (dry-run)", () => {
    const s = new BlueprintStore(seed, join(dir, "bp.json"));
    const revBefore = s.rev();
    s.propose([{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }], "test");
    expect(s.rev()).toBe(revBefore);
    expect(s.get().nodes.find((n) => n.id === "n_a")!.status).toBe("draft");
  });

  it("confirm 후 rev 가 +1 되고 영속화된다", () => {
    const path = join(dir, "bp.json");
    const s = new BlueprintStore(seed, path);
    const p = s.propose([{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }], "t");
    const r = s.confirm(p.id, { actor: "user" });
    expect(r?.rev).toBe(2);
    const onDisk = JSON.parse(readFileSync(path, "utf8")) as Blueprint;
    expect(onDisk.meta.rev).toBe(2);
    expect(onDisk.nodes.find((n) => n.id === "n_a")!.status).toBe("confirmed");
  });

  it("baseRev mismatch 는 confirm 을 거부한다", () => {
    const s = new BlueprintStore(seed, join(dir, "bp.json"));
    const p1 = s.propose([{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }], "first");
    const p2 = s.propose([{ op: "update_node", id: "n_a", patch: { priority: "P1" } }], "second", { baseRev: 1 });
    s.confirm(p1.id); // rev → 2
    const r = s.confirm(p2.id); // baseRev=1 이라 충돌
    expect(r).toBeNull();
  });

  it("snapshot 이 생성되고 restore 로 복구된다", () => {
    const path = join(dir, "bp.json");
    const s = new BlueprintStore(seed, path);
    const p = s.propose([{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }], "t");
    const r = s.confirm(p.id);
    expect(r?.snapshotSha).toHaveLength(12);
    const snaps = s.listSnapshots();
    expect(snaps.length).toBeGreaterThanOrEqual(1);

    // 변경 후 복구
    const p2 = s.propose([{ op: "remove_node", id: "n_a" }], "remove");
    s.confirm(p2.id);
    expect(s.get().nodes.find((n) => n.id === "n_a")).toBeUndefined();

    s.restore(r!.snapshotSha);
    expect(s.get().nodes.find((n) => n.id === "n_a")).toBeDefined();
  });

  it("audit.jsonl 이 append-only 로 기록된다", () => {
    const path = join(dir, "bp.json");
    const auditPath = join(dir, "audit.jsonl");
    const s = new BlueprintStore(seed, path);
    const p = s.propose([{ op: "update_node", id: "n_a", patch: { status: "confirmed" } }], "t");
    s.confirm(p.id);
    expect(existsSync(auditPath)).toBe(true);
    const lines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3); // propose + confirm + snapshot
    const kinds = lines.map((l) => JSON.parse(l).kind);
    expect(kinds).toContain("propose");
    expect(kinds).toContain("confirm");
    expect(kinds).toContain("snapshot");
  });

  it("reject 는 BP 를 변경하지 않고 감사에 기록한다", () => {
    const s = new BlueprintStore(seed, join(dir, "bp.json"));
    const p = s.propose([{ op: "remove_node", id: "n_a" }], "t");
    const ok = s.reject(p.id, { actor: "user", reason: "test" });
    expect(ok).toBe(true);
    expect(s.get().nodes.find((n) => n.id === "n_a")).toBeDefined();
    const audit = s.tailAudit(10);
    expect(audit.find((e) => e.kind === "reject")).toBeDefined();
  });
});
