import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
  appendFileSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import type {
  Blueprint,
  Actor,
  ActorRole,
  AuthzPolicy,
} from "./core/types.js";
import { DEFAULT_AUTHZ } from "./core/types.js";
import { applyOps, type BlueprintOp, type OpResult } from "./core/ops.js";
import { blastRadius, type ImpactReport } from "./core/impact.js";

interface PendingProposal {
  id: string;
  ops: BlueprintOp[];
  intent: string;
  impact: ImpactReport;
  actor: string;
  createdAt: number;
  /** propose 시점의 meta.rev (낙관락 baseline) */
  baseRev: number;
}

export interface AuditEntry {
  ts: number;
  actor: string;
  kind: "propose" | "confirm" | "reject" | "snapshot" | "restore";
  proposalId?: string;
  intent?: string;
  rev?: number;
  /** 적용된 ops (confirm 시) */
  ops?: BlueprintOp[];
  /** rejected ops (confirm 시) */
  rejected?: { op: BlueprintOp; reason: string }[];
  impact?: { level: string; affected: number };
  snapshotSha?: string;
  note?: string;
}

export interface ProposeResult {
  proposal: PendingProposal;
}

export interface ConfirmResult {
  result: OpResult;
  impact: ImpactReport;
  rev: number;
  snapshotSha: string;
}

/**
 * BlueprintStore — 단일 진실원천 + 영속화 + confirm 게이트 + 감사 로그 + 스냅샷 롤백.
 *
 * 안전 원칙:
 *  1) 자동머지 금지 — update 는 propose 만, confirm 으로만 반영.
 *  2) 낙관 동시성 — propose 의 baseRev 가 현재 rev 와 다르면 충돌(rev_mismatch) 거부.
 *  3) WAL → swap — bp.json.wal 에 먼저 쓰고 rename 으로 원본 교체.
 *  4) 스냅샷 — confirm 마다 .blueprint/snapshots/<rev>-<sha>.json 보관(롤백 가능).
 *  5) 감사 로그 — .blueprint/audit.jsonl 에 모든 propose/confirm/reject/snapshot/restore append.
 */
export interface StoreOptions {
  /** authz 정책. 미설정 시 모든 actor 통과(기존 동작 보존). */
  authz?: AuthzPolicy;
  /**
   * true 면 propose 한 actor 가 스스로 confirm 하는 것을 거부 (BLUEPRINT.md NFR:
   * "confirm 은 사람 actor 권장, 에이전트 자가승인 금지"의 강제 장치).
   * 기본 false — 기존 동작·단일 사용자 흐름 보존.
   */
  forbidSelfConfirm?: boolean;
}

export type StoreEvent =
  | { kind: "proposed"; proposalId: string; intent: string; rev: number; actor: string }
  | { kind: "confirmed"; proposalId: string; rev: number; snapshotSha: string; actor: string }
  | { kind: "rejected"; proposalId?: string; reason: string; actor: string }
  | { kind: "restored"; rev: number; snapshotSha: string; actor: string };

export class BlueprintStore {
  private bp: Blueprint;
  private path?: string;
  private pending = new Map<string, PendingProposal>();
  private auditPath?: string;
  private snapshotDir?: string;
  private authz?: Required<AuthzPolicy>;
  private forbidSelfConfirm = false;
  private bus = new EventEmitter();
  /** 마지막으로 읽거나 쓴 파일 mtime(ms). 외부(웹 FileStore 등) 변경 감지용. */
  private lastMtimeMs?: number;

  /** SSE 등 외부 listener 가 구독. unsubscribe 함수를 반환. */
  on(handler: (e: StoreEvent) => void): () => void {
    this.bus.on("event", handler);
    return () => this.bus.off("event", handler);
  }

  private emit(e: StoreEvent): void {
    this.bus.emit("event", e);
  }

  constructor(initial: Blueprint, path?: string, opts: StoreOptions = {}) {
    if (opts.authz) {
      this.authz = { ...DEFAULT_AUTHZ, ...opts.authz };
    }
    this.forbidSelfConfirm = opts.forbidSelfConfirm ?? false;
    this.path = path;
    if (path) {
      const dir = dirname(path);
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        /* ignore */
      }
      this.auditPath = join(dir, "audit.jsonl");
      this.snapshotDir = join(dir, "snapshots");
      try {
        mkdirSync(this.snapshotDir, { recursive: true });
      } catch {
        /* ignore */
      }
    }

    if (path && existsSync(path)) {
      this.bp = JSON.parse(readFileSync(path, "utf8")) as Blueprint;
    } else {
      this.bp = initial;
    }
    if (!this.bp.meta.rev) {
      this.bp.meta.rev = 1;
    }
    this.persist();
  }

  /**
   * 외부 writer(웹 FileStore·다른 프로세스)가 파일을 바꿨으면 메모리 BP 를 갱신.
   * mtime 비교로 변경 시에만 재파싱. 우리 자신의 persist() 는 mtime 을 갱신하므로 재읽기 안 함.
   * 파싱 실패/파일 없음 시 메모리 BP 유지(치명적이지 않게).
   */
  private reloadIfChanged(): void {
    if (!this.path) return;
    try {
      const st = statSync(this.path);
      if (this.lastMtimeMs === undefined || st.mtimeMs > this.lastMtimeMs) {
        const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Blueprint;
        if (parsed && parsed.nodes && parsed.edges && parsed.meta) {
          this.bp = parsed;
          if (!this.bp.meta.rev) this.bp.meta.rev = 1;
        }
        this.lastMtimeMs = st.mtimeMs;
      }
    } catch {
      /* 파일 없음/파싱 실패 — 메모리 유지 */
    }
  }

  get(): Blueprint {
    this.reloadIfChanged();
    return this.bp;
  }

  /** 권한 정책이 켜져 있을 때만 actor 의 role 을 검사. 통과 = true. */
  private check(action: keyof Required<AuthzPolicy>, role: ActorRole | undefined): boolean {
    if (!this.authz) return true;
    if (!role) return false; // 정책이 켜진 환경에선 role 미지정 시 거부
    return this.authz[action].includes(role);
  }

  rev(): number {
    return this.bp.meta.rev ?? 1;
  }

  /** WAL → swap 으로 원자적 영속화. */
  private persist(): void {
    if (!this.path) return;
    const tmp = `${this.path}.wal`;
    try {
      writeFileSync(tmp, JSON.stringify(this.bp, null, 2), "utf8");
      renameSync(tmp, this.path);
      try { this.lastMtimeMs = statSync(this.path).mtimeMs; } catch { /* ignore */ }
    } catch (e) {
      // persist 실패는 치명적이지 않게 stderr 로만 — 메모리 상 BP 유지
      console.error(`[ubp] persist 실패(메모리 유지): ${(e as Error).message}`);
    }
  }

  private writeAudit(entry: AuditEntry): void {
    if (!this.auditPath) return;
    try {
      // 10MB 로테이션 — tailAudit 이 전체 파일을 메모리에 올리므로 무한 성장 차단.
      try {
        const st = statSync(this.auditPath);
        if (st.size > 10 * 1024 * 1024) {
          const stamp = new Date(Date.now()).toISOString().slice(0, 10);
          renameSync(
            this.auditPath,
            this.auditPath.replace(/\.jsonl$/, "") + `-${stamp}-${st.mtimeMs % 100000 | 0}.jsonl`,
          );
        }
      } catch { /* 파일 없음 — 첫 기록 */ }
      appendFileSync(this.auditPath, JSON.stringify(entry) + "\n", "utf8");
    } catch (e) {
      console.error(`[ubp] audit 실패: ${(e as Error).message}`);
    }
  }

  /** 직렬화된 BP 의 SHA-256 12자리 prefix. */
  private hash(): string {
    const json = JSON.stringify(this.bp);
    return createHash("sha256").update(json).digest("hex").slice(0, 12);
  }

  private snapshot(rev: number, actor: string, intent: string): string {
    const sha = this.hash();
    if (this.snapshotDir) {
      const file = join(this.snapshotDir, `r${String(rev).padStart(5, "0")}-${sha}.json`);
      try {
        // 스냅샷은 사람이 직접 읽는 파일이 아님 — compact 로 저장 공간 ~20% 절약 (bp.json 본체는 pretty 유지)
        writeFileSync(
          file,
          JSON.stringify({ rev, sha, actor, intent, ts: Date.now(), bp: this.bp }),
          "utf8",
        );
        this.pruneSnapshots(50);
      } catch (e) {
        console.error(`[ubp] snapshot 실패: ${(e as Error).message}`);
      }
    }
    this.writeAudit({
      ts: Date.now(),
      actor,
      kind: "snapshot",
      rev,
      snapshotSha: sha,
      intent,
    });
    return sha;
  }

  private pruneSnapshots(keep: number): void {
    if (!this.snapshotDir) return;
    try {
      const files = readdirSync(this.snapshotDir).sort();
      const excess = files.length - keep;
      if (excess > 0) {
        for (let i = 0; i < excess; i++) {
          try {
            const target = join(this.snapshotDir, files[i]);
            // 직접 unlink 대신 추후 회수 위해 .trash 디렉토리로 이동도 고려.
            // 지금은 단순 삭제.
            unlinkSync(target);
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  private touchedIds(ops: BlueprintOp[]): string[] {
    const ids = new Set<string>();
    for (const op of ops) {
      if (op.op === "add_node") ids.add(op.node.id);
      else if (op.op === "update_node" || op.op === "remove_node") ids.add(op.id);
      else if (op.op === "add_edge" || op.op === "remove_edge") {
        ids.add(op.edge.from);
        ids.add(op.edge.to);
      }
    }
    return [...ids];
  }

  /** 제안(dry-run). confirm 전까지 BP 변경 없음. actor 는 문자열(이름) 또는 Actor(role 포함). */
  propose(
    ops: BlueprintOp[],
    intent: string,
    opts: { actor?: string | Actor; baseRev?: number } = {},
  ): PendingProposal {
    this.reloadIfChanged(); // 외부 변경 반영 후 baseRev 캡처
    const actorObj: Actor | undefined =
      typeof opts.actor === "object" ? opts.actor : undefined;
    const actor = actorObj ? actorObj.id : (opts.actor as string | undefined) ?? "agent";

    // authz 가 켜져 있고 propose 권한 없으면 빈 제안 반환(거부 기록).
    if (this.authz && !this.check("canPropose", actorObj?.role)) {
      this.writeAudit({
        ts: Date.now(),
        actor,
        kind: "reject",
        note: `forbidden_propose (role=${actorObj?.role ?? "none"})`,
      });
      // 호출자 식별을 위해 placeholder 제안 객체를 반환하지 않고 throw 도 하지 않음 —
      // 대신 의도가 "제안 실패"임을 알리는 비어있는 ops 의 객체 반환.
      const ghost: PendingProposal = {
        id: `forbidden_${Date.now() % 100000}`,
        ops: [],
        intent: `[FORBIDDEN] ${intent}`,
        impact: { changed: [], affected: [], affectedTitles: [], level: "국소" },
        actor,
        createdAt: Date.now(),
        baseRev: this.rev(),
      };
      return ghost;
    }

    const baseRev = opts.baseRev ?? this.rev();
    const impact = blastRadius(this.bp, this.touchedIds(ops));
    const proposal: PendingProposal = {
      id: `p_${randomUUID().slice(0, 8)}`,
      ops,
      intent,
      impact,
      actor,
      createdAt: Date.now(),
      baseRev,
    };
    this.pending.set(proposal.id, proposal);
    this.writeAudit({
      ts: proposal.createdAt,
      actor,
      kind: "propose",
      proposalId: proposal.id,
      intent,
      rev: baseRev,
      ops,
      impact: { level: impact.level, affected: impact.affected.length },
    });
    this.emit({ kind: "proposed", proposalId: proposal.id, intent, rev: baseRev, actor });
    return proposal;
  }

  /** 승인 시에만 실제 반영 + 영속화 + 스냅샷. 사람 actor 권장. authz 가 켜져 있으면 role 검사. */
  confirm(proposalId: string, opts: { actor?: string | Actor } = {}): ConfirmResult | null {
    const p = this.pending.get(proposalId);
    if (!p) return null;
    this.reloadIfChanged(); // 외부 변경 반영 → baseRev 낙관락이 외부 writer 도 잡도록
    const actorObj: Actor | undefined =
      typeof opts.actor === "object" ? opts.actor : undefined;
    const actor = actorObj ? actorObj.id : (opts.actor as string | undefined) ?? "user";

    if (this.authz && !this.check("canConfirm", actorObj?.role)) {
      this.writeAudit({
        ts: Date.now(),
        actor,
        kind: "reject",
        proposalId,
        note: `forbidden_confirm (role=${actorObj?.role ?? "none"})`,
      });
      return null;
    }

    // 에이전트 자가승인 차단 — propose 한 actor 와 confirm actor 가 같으면 거부 (opt-in).
    if (this.forbidSelfConfirm && p.actor === actor) {
      this.writeAudit({
        ts: Date.now(),
        actor,
        kind: "reject",
        proposalId,
        note: `self_confirm_forbidden (proposer=${p.actor})`,
      });
      return null;
    }

    // 낙관 동시성: 제안 후 다른 confirm 으로 rev 가 진행됐다면 충돌.
    if (p.baseRev !== this.rev()) {
      this.writeAudit({
        ts: Date.now(),
        actor,
        kind: "reject",
        proposalId,
        note: `rev_mismatch (base=${p.baseRev}, current=${this.rev()})`,
      });
      this.pending.delete(proposalId);
      return null;
    }

    const { next, result } = applyOps(this.bp, p.ops);
    if (result.ok || result.applied > 0) {
      const newRev = this.rev() + 1;
      this.bp = next;
      this.bp.meta.rev = newRev;
      this.persist();
      const sha = this.snapshot(newRev, actor, p.intent);
      this.pending.delete(proposalId);

      this.writeAudit({
        ts: Date.now(),
        actor,
        kind: "confirm",
        proposalId,
        intent: p.intent,
        rev: newRev,
        ops: p.ops,
        rejected: result.rejected,
        impact: { level: p.impact.level, affected: p.impact.affected.length },
        snapshotSha: sha,
      });
      this.emit({ kind: "confirmed", proposalId, rev: newRev, snapshotSha: sha, actor });

      return { result, impact: p.impact, rev: newRev, snapshotSha: sha };
    }

    // 모든 op 가 거부됐을 경우
    this.pending.delete(proposalId);
    this.writeAudit({
      ts: Date.now(),
      actor,
      kind: "reject",
      proposalId,
      note: "all_ops_rejected",
      rejected: result.rejected,
    });
    return { result, impact: p.impact, rev: this.rev(), snapshotSha: "" };
  }

  reject(proposalId: string, opts: { actor?: string | Actor; reason?: string } = {}): boolean {
    const p = this.pending.get(proposalId);
    if (!p) return false;
    const actorObj: Actor | undefined =
      typeof opts.actor === "object" ? opts.actor : undefined;
    const actor = actorObj ? actorObj.id : (opts.actor as string | undefined) ?? "user";
    this.pending.delete(proposalId);
    this.writeAudit({
      ts: Date.now(),
      actor,
      kind: "reject",
      proposalId,
      note: opts.reason ?? "manual_reject",
    });
    this.emit({ kind: "rejected", proposalId, reason: opts.reason ?? "manual_reject", actor });
    return true;
  }

  /** 보류 중 제안 조회. */
  listPending(): PendingProposal[] {
    return [...this.pending.values()];
  }

  /** 최근 감사 로그 N건 반환. */
  tailAudit(n = 20): AuditEntry[] {
    if (!this.auditPath || !existsSync(this.auditPath)) return [];
    try {
      const lines = readFileSync(this.auditPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
      return lines
        .slice(-n)
        .map((l) => JSON.parse(l) as AuditEntry);
    } catch {
      return [];
    }
  }

  /** 스냅샷 목록. */
  listSnapshots(): { file: string; rev: number; sha: string }[] {
    if (!this.snapshotDir || !existsSync(this.snapshotDir)) return [];
    try {
      return readdirSync(this.snapshotDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((file) => {
          const m = file.match(/^r(\d+)-([a-f0-9]+)\.json$/);
          return { file, rev: m ? parseInt(m[1], 10) : 0, sha: m ? m[2] : "" };
        });
    } catch {
      return [];
    }
  }

  /** 특정 스냅샷으로 복구(현재 BP 를 새 rev 로 진행). 사람 actor 권장. authz 가 켜져 있으면 role 검사. */
  restore(sha: string, opts: { actor?: string | Actor } = {}): { rev: number } | null {
    const actorObj: Actor | undefined =
      typeof opts.actor === "object" ? opts.actor : undefined;
    const actor = actorObj ? actorObj.id : (opts.actor as string | undefined) ?? "user";

    if (this.authz && !this.check("canRestore", actorObj?.role)) {
      this.writeAudit({
        ts: Date.now(),
        actor,
        kind: "reject",
        note: `forbidden_restore (role=${actorObj?.role ?? "none"})`,
      });
      return null;
    }
    if (!this.snapshotDir) return null;
    const matches = readdirSync(this.snapshotDir).filter((f) => f.includes(sha));
    if (matches.length === 0) return null;
    const payload = JSON.parse(readFileSync(join(this.snapshotDir, matches[0]), "utf8")) as {
      bp: Blueprint;
    };
    const newRev = this.rev() + 1;
    this.bp = payload.bp;
    this.bp.meta.rev = newRev;
    this.persist();
    this.writeAudit({
      ts: Date.now(),
      actor,
      kind: "restore",
      rev: newRev,
      snapshotSha: sha,
      note: `restored_from ${matches[0]}`,
    });
    this.emit({ kind: "restored", rev: newRev, snapshotSha: sha, actor });
    return { rev: newRev };
  }
}
