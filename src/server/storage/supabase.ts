import { createHash } from "node:crypto";
import type { Blueprint } from "../../core/types.js";
import type { BlueprintOp, OpResult } from "../../core/ops.js";
import { applyOps } from "../../core/ops.js";
import type { Actor } from "../../core/types.js";
import { DEFAULT_AUTHZ } from "../../core/types.js";
import type { AuditEntry, ConfirmResult, StoreEvent } from "../../store.js";
import { blastRadius } from "../../core/impact.js";
import type {
  BlueprintStorage,
  PendingProposal,
  StorageBackendModule,
  StorageOptions,
} from "./interface.js";

/**
 * SupabaseStorage — Postgres + RLS + Realtime 기반 멀티테넌트.
 *
 * 동적 import:
 *   - @supabase/supabase-js 가 설치돼 있을 때만 활성.
 *   - 없으면 createSupabaseStorage 가 친절한 에러 throw.
 *
 * 환경 변수:
 *   - SUPABASE_URL
 *   - SUPABASE_KEY  (service_role 키 — 서버 전용. RLS bypass 위해서. anon 키도 가능하나 RLS 따름)
 *   - UBP_WORKSPACE_ID  (워크스페이스 ID — 기본 'default')
 *
 * 스키마: supabase.sql 적용 필요.
 */

interface SupabaseClient {
  from(table: string): {
    select(cols?: string): {
      eq(col: string, val: unknown): { single?: () => Promise<{ data: unknown; error: unknown }> };
      order?(col: string, opts?: { ascending?: boolean }): { limit(n: number): { data?: unknown[]; error?: unknown } };
    } & Promise<{ data: unknown[]; error: unknown }>;
    insert(row: Record<string, unknown>): Promise<{ error: unknown }>;
    update(row: Record<string, unknown>): { eq(col: string, val: unknown): Promise<{ error: unknown }> };
    delete(): { eq(col: string, val: unknown): Promise<{ error: unknown }> };
    upsert(row: Record<string, unknown>): Promise<{ error: unknown }>;
  };
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  channel(name: string): {
    on(event: string, opts: unknown, cb: (payload: unknown) => void): { subscribe(): unknown };
    send(payload: unknown): Promise<unknown>;
  };
}

class SupabaseStorage implements BlueprintStorage {
  readonly backend = "supabase" as const;
  private bp: Blueprint;
  private currentRev: number;
  private workspaceId: string;
  private client: SupabaseClient;
  private authz: Required<typeof DEFAULT_AUTHZ> | undefined;
  private listeners = new Set<(e: StoreEvent) => void>();
  private pendingCache = new Map<string, PendingProposal>();

  constructor(opts: { initial: Blueprint; workspaceId: string; client: SupabaseClient; authz?: typeof DEFAULT_AUTHZ }) {
    this.bp = opts.initial;
    this.currentRev = opts.initial.meta.rev ?? 1;
    this.workspaceId = opts.workspaceId;
    this.client = opts.client;
    this.authz = opts.authz ? { ...DEFAULT_AUTHZ, ...opts.authz } : undefined;
  }

  async _bootstrap(): Promise<void> {
    // blueprints 테이블에서 fetch — 없으면 upsert
    const sel = await this.client.from("blueprints").select("bp,rev")
      .eq("workspace_id", this.workspaceId);
    const rows = (sel as { data?: unknown[] }).data || [];
    if (rows.length > 0) {
      const row = rows[0] as { bp: Blueprint; rev: number };
      this.bp = row.bp;
      this.currentRev = row.rev;
    } else {
      await this.client.from("blueprints").insert({
        workspace_id: this.workspaceId,
        bp: this.bp,
        rev: this.currentRev,
      });
    }
    this.subscribeRealtime();
  }

  private subscribeRealtime(): void {
    const ch = this.client.channel(`ws_${this.workspaceId}`);
    const sub = ch.on(
      "postgres_changes",
      { event: "*", schema: "public", filter: `workspace_id=eq.${this.workspaceId}` },
      (payload: unknown) => {
        const p = payload as { eventType?: string; new?: unknown; table?: string };
        if (p.table === "blueprints" && p.eventType === "UPDATE") {
          const next = (p.new as { bp?: Blueprint; rev?: number });
          if (next.bp && typeof next.rev === "number") {
            this.bp = next.bp;
            this.currentRev = next.rev;
            this.emit({ kind: "confirmed", proposalId: "(remote)", rev: next.rev, snapshotSha: "", actor: "remote" });
          }
        }
      },
    );
    sub.subscribe();
  }

  get(): Blueprint { return this.bp; }
  rev(): number { return this.currentRev; }

  private check(action: keyof typeof DEFAULT_AUTHZ, role: Actor["role"] | undefined): boolean {
    if (!this.authz) return true;
    if (!role) return false;
    return this.authz[action].includes(role);
  }

  propose(
    ops: BlueprintOp[],
    intent: string,
    opts: { actor?: string | Actor; baseRev?: number } = {},
  ): PendingProposal {
    const actorObj = typeof opts.actor === "object" ? opts.actor : undefined;
    const actor = actorObj ? actorObj.id : (opts.actor as string | undefined) ?? "agent";
    const baseRev = opts.baseRev ?? this.currentRev;

    if (this.authz && !this.check("canPropose", actorObj?.role)) {
      const ghost: PendingProposal = {
        id: `forbidden_${Date.now()}`, ops: [], intent: `[FORBIDDEN] ${intent}`,
        actor, baseRev: this.currentRev, createdAt: Date.now(),
        impact: { changed: [], affected: [], affectedTitles: [], level: "국소" },
      };
      return ghost;
    }

    // touchedIds 계산
    const ids = new Set<string>();
    for (const op of ops) {
      if (op.op === "add_node") ids.add(op.node.id);
      else if (op.op === "update_node" || op.op === "remove_node") ids.add(op.id);
      else if (op.op === "add_edge" || op.op === "remove_edge") { ids.add(op.edge.from); ids.add(op.edge.to); }
    }
    const impact = blastRadius(this.bp, [...ids]);

    const id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const proposal: PendingProposal = { id, ops, intent, impact, actor, createdAt: Date.now(), baseRev };
    this.pendingCache.set(id, proposal);

    // pending_proposals 테이블 insert (best-effort, 실패해도 메모리 캐시 보존)
    void this.client.from("pending_proposals").insert({
      id,
      workspace_id: this.workspaceId,
      ops: ops as unknown as Record<string, unknown>,
      intent,
      actor_id: actor,
      base_rev: baseRev,
      impact: { level: impact.level, affected: impact.affected.length } as unknown as Record<string, unknown>,
    });
    void this.client.from("audit_entries").insert({
      workspace_id: this.workspaceId,
      actor_id: actor,
      kind: "propose",
      proposal_id: id,
      rev: baseRev,
      payload: { ops, intent, impact: { level: impact.level, affected: impact.affected.length } } as unknown as Record<string, unknown>,
    });
    this.emit({ kind: "proposed", proposalId: id, intent, rev: baseRev, actor });
    return proposal;
  }

  confirm(proposalId: string, opts: { actor?: string | Actor } = {}): ConfirmResult | null {
    const actorObj = typeof opts.actor === "object" ? opts.actor : undefined;
    const actor = actorObj ? actorObj.id : (opts.actor as string | undefined) ?? "user";
    if (this.authz && !this.check("canConfirm", actorObj?.role)) return null;

    const p = this.pendingCache.get(proposalId);
    if (!p) return null;
    if (p.baseRev !== this.currentRev) {
      this.pendingCache.delete(proposalId);
      return null;
    }

    const { next, result } = applyOps(this.bp, p.ops);
    if (result.applied === 0) {
      this.pendingCache.delete(proposalId);
      return { result, impact: p.impact, rev: this.currentRev, snapshotSha: "" };
    }

    const newRev = this.currentRev + 1;
    next.meta.rev = newRev;
    const sha = createHash("sha256").update(JSON.stringify(next)).digest("hex").slice(0, 12);

    this.bp = next;
    this.currentRev = newRev;

    // 비동기 — 실패하면 다음 read 에서 RLS 충돌 가능. 단순화 위해 fire-and-forget.
    void this.client.from("blueprints").update({
      bp: next as unknown as Record<string, unknown>,
      rev: newRev,
    }).eq("workspace_id", this.workspaceId);
    void this.client.from("snapshots").insert({
      workspace_id: this.workspaceId,
      rev: newRev,
      sha,
      bp: next as unknown as Record<string, unknown>,
      actor_id: actor,
      intent: p.intent,
    });
    void this.client.from("audit_entries").insert({
      workspace_id: this.workspaceId,
      actor_id: actor,
      kind: "confirm",
      proposal_id: proposalId,
      rev: newRev,
      payload: { ops: p.ops, intent: p.intent, snapshotSha: sha } as unknown as Record<string, unknown>,
    });
    void this.client.from("pending_proposals").delete().eq("id", proposalId);

    this.pendingCache.delete(proposalId);
    this.emit({ kind: "confirmed", proposalId, rev: newRev, snapshotSha: sha, actor });
    return { result, impact: p.impact, rev: newRev, snapshotSha: sha };
  }

  reject(proposalId: string, opts: { actor?: string | Actor; reason?: string } = {}): boolean {
    const actorObj = typeof opts.actor === "object" ? opts.actor : undefined;
    const actor = actorObj ? actorObj.id : (opts.actor as string | undefined) ?? "user";
    const p = this.pendingCache.get(proposalId);
    if (!p) return false;
    this.pendingCache.delete(proposalId);
    void this.client.from("pending_proposals").delete().eq("id", proposalId);
    void this.client.from("audit_entries").insert({
      workspace_id: this.workspaceId,
      actor_id: actor,
      kind: "reject",
      proposal_id: proposalId,
      payload: { note: opts.reason ?? "manual_reject" } as unknown as Record<string, unknown>,
    });
    this.emit({ kind: "rejected", proposalId, reason: opts.reason ?? "manual_reject", actor });
    return true;
  }

  listPending(): PendingProposal[] { return [...this.pendingCache.values()]; }

  // sync 폴백 — cloud 환경에선 빈 배열. async 메서드 사용 권장.
  tailAudit(_n = 50): AuditEntry[] { return []; }
  listSnapshots(): { file: string; rev: number; sha: string }[] { return []; }

  async tailAuditAsync(n = 50): Promise<AuditEntry[]> {
    // postgres: SELECT * FROM audit_entries WHERE workspace_id=$1 ORDER BY ts DESC LIMIT $2
    const sel = await (this.client.from("audit_entries").select("*")
      .eq("workspace_id", this.workspaceId) as unknown as Promise<{ data?: unknown[] }>);
    const rows = (sel.data || []) as Array<{
      ts: string; actor_id?: string; kind: AuditEntry["kind"];
      proposal_id?: string; rev?: number; payload?: Record<string, unknown>;
    }>;
    return rows.slice(-n).map((r): AuditEntry => ({
      ts: new Date(r.ts).getTime(),
      actor: r.actor_id ?? "unknown",
      kind: r.kind,
      proposalId: r.proposal_id,
      rev: r.rev,
      ...(r.payload || {}),
    } as AuditEntry));
  }

  async listSnapshotsAsync(): Promise<{ file: string; rev: number; sha: string }[]> {
    const sel = await (this.client.from("snapshots").select("rev,sha")
      .eq("workspace_id", this.workspaceId) as unknown as Promise<{ data?: unknown[] }>);
    const rows = (sel.data || []) as Array<{ rev: number; sha: string }>;
    return rows.map((r) => ({ file: `r${String(r.rev).padStart(5, "0")}-${r.sha}.json`, rev: r.rev, sha: r.sha }));
  }

  restore(sha: string, opts: { actor?: string | Actor } = {}): { rev: number } | null {
    const actorObj = typeof opts.actor === "object" ? opts.actor : undefined;
    const actor = actorObj ? actorObj.id : (opts.actor as string | undefined) ?? "user";
    if (this.authz && !this.check("canRestore", actorObj?.role)) return null;

    // 비동기 fetch + apply — fire and forget, 정확한 동기 반환은 placeholder
    void (async () => {
      const sel = await this.client.from("snapshots").select("bp,rev")
        .eq("workspace_id", this.workspaceId);
      const rows = (sel as { data?: { bp: Blueprint; rev: number; sha: string }[] }).data || [];
      const found = rows.find((r) => (r as unknown as { sha: string }).sha === sha);
      if (!found) return;
      const newRev = this.currentRev + 1;
      const restored = { ...found.bp, meta: { ...found.bp.meta, rev: newRev } };
      this.bp = restored;
      this.currentRev = newRev;
      await this.client.from("blueprints").update({
        bp: restored as unknown as Record<string, unknown>,
        rev: newRev,
      }).eq("workspace_id", this.workspaceId);
      await this.client.from("audit_entries").insert({
        workspace_id: this.workspaceId,
        actor_id: actor,
        kind: "restore",
        rev: newRev,
        payload: { snapshotSha: sha } as unknown as Record<string, unknown>,
      });
      this.emit({ kind: "restored", rev: newRev, snapshotSha: sha, actor });
    })();
    return { rev: this.currentRev + 1 };
  }

  on(handler: (e: StoreEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  private emit(e: StoreEvent): void {
    for (const h of this.listeners) {
      try { h(e); } catch { /* ignore */ }
    }
  }
}

/** Supabase 클라이언트 동적 로드. 의존성 없으면 throw. */
async function loadSupabaseClient(): Promise<{ createClient: (url: string, key: string) => SupabaseClient }> {
  try {
    // 런타임 동적 import — TS 빌드 시 의존성 없어도 OK.
    const mod = await import(/* @vite-ignore */ "@supabase/supabase-js" as string);
    return mod as { createClient: (url: string, key: string) => SupabaseClient };
  } catch {
    throw new Error(
      "@supabase/supabase-js 가 설치되지 않음. `npm i @supabase/supabase-js` 후 재시작.",
    );
  }
}

export const supabaseBackend: StorageBackendModule = {
  id: "supabase",
  async create(initial: Blueprint, opts: StorageOptions = {}): Promise<BlueprintStorage> {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    const workspaceId = process.env.UBP_WORKSPACE_ID || initial.meta.workspaceId || "default";
    if (!url || !key) {
      throw new Error(
        "Supabase 환경 변수 미설정 — SUPABASE_URL, SUPABASE_KEY 필요.",
      );
    }
    const { createClient } = await loadSupabaseClient();
    const client = createClient(url, key);
    const store = new SupabaseStorage({
      initial: { ...initial, meta: { ...initial.meta, workspaceId } },
      workspaceId,
      client,
      authz: opts.authz as typeof DEFAULT_AUTHZ | undefined,
    });
    await store._bootstrap();
    return store;
  },
};

export { SupabaseStorage };
