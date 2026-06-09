import type { Blueprint } from "../../core/types.js";
import type { BlueprintOp, OpResult } from "../../core/ops.js";
import type { ImpactReport } from "../../core/impact.js";
import type { Actor, AuthzPolicy } from "../../core/types.js";
import type { AuditEntry, ConfirmResult, StoreEvent } from "../../store.js";

/**
 * BlueprintStorage — 멀티 백엔드 추상화.
 *
 * 구현체:
 *   - FileSystemStorage: bp.json + audit.jsonl + snapshots/ 디렉토리 (현재 기본)
 *   - PostgresStorage:   자체 호스팅 Postgres + JSONB 컬럼
 *   - SupabaseStorage:   Supabase Postgres + RLS + Storage(첨부 옵션)
 *   - TursoStorage:      SQLite cloud (libSQL)
 *
 * 모든 confirm/propose/snapshot/audit 흐름은 동일 — backend 만 교체.
 * 환경 변수 UBP_BACKEND=filesystem|postgres|supabase|turso 로 선택.
 */
export interface PendingProposal {
  id: string;
  ops: BlueprintOp[];
  intent: string;
  impact: ImpactReport;
  actor: string;
  createdAt: number;
  baseRev: number;
}

export interface BlueprintStorage {
  /** 백엔드 식별자. 로그·디버그·메트릭 태깅용. */
  readonly backend: "filesystem" | "postgres" | "supabase" | "turso";

  /** 현재 BP. */
  get(): Blueprint;
  /** 현재 rev. */
  rev(): number;

  /** 제안 생성 (dry-run). confirm 전 BP 변경 없음. */
  propose(
    ops: BlueprintOp[],
    intent: string,
    opts?: { actor?: string | Actor; baseRev?: number },
  ): PendingProposal;

  /** 승인. baseRev mismatch / role 권한 부족 시 null. */
  confirm(proposalId: string, opts?: { actor?: string | Actor }): ConfirmResult | null;

  /** 거절. */
  reject(proposalId: string, opts?: { actor?: string | Actor; reason?: string }): boolean;

  /** 보류 중 제안. */
  listPending(): PendingProposal[];

  /** 감사 로그 최근 N 건 — sync. filesystem 백엔드는 즉시 반환, cloud 백엔드는 캐시 fallback (빈 배열). */
  tailAudit(n?: number): AuditEntry[];

  /** 감사 로그 최근 N 건 — async. cloud 백엔드는 실 DB select. */
  tailAuditAsync?(n?: number): Promise<AuditEntry[]>;

  /** 스냅샷 목록 — sync. */
  listSnapshots(): { file: string; rev: number; sha: string }[];

  /** 스냅샷 목록 — async. cloud 백엔드는 실 DB select. */
  listSnapshotsAsync?(): Promise<{ file: string; rev: number; sha: string }[]>;

  /** 스냅샷 복구. */
  restore(sha: string, opts?: { actor?: string | Actor }): { rev: number } | null;

  /** 이벤트 구독 (SSE 등). 반환 = unsubscribe. */
  on(handler: (e: StoreEvent) => void): () => void;
}

/** 백엔드 공통 옵션. */
export interface StorageOptions {
  /** authz 정책. 미설정 시 모든 actor 통과. */
  authz?: AuthzPolicy;
}

/** 백엔드 팩토리 — 환경에 맞춰 인스턴스를 선택. */
export interface StorageBackendModule {
  /** 환경변수 UBP_BACKEND 값과 매칭. */
  id: "filesystem" | "postgres" | "supabase" | "turso";
  /** 백엔드 생성. 백엔드별 옵션은 env 또는 별도 config 로 읽음. */
  create(initial: Blueprint, opts?: StorageOptions): Promise<BlueprintStorage>;
}
