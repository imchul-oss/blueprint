import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { Blueprint } from "../core/types.js";
import type { BlueprintStorage } from "./storage/index.js";
import { createWorkspaceStorage, getActiveBackendId, createStorage } from "./storage/index.js";

/**
 * Workspace 단위 BlueprintStorage 풀.
 *
 * 백엔드:
 *   - filesystem (기본): 워크스페이스별 별도 디렉토리 + BlueprintStore 어댑트
 *   - supabase / postgres / turso: SupabaseStorage 등이 workspace_id 로 자체 격리.
 *     filesystem 외 백엔드는 한 인스턴스가 모든 워크스페이스를 처리 가능 — 단,
 *     현 구조는 워크스페이스 단위 인스턴스화. cloud 백엔드는 workspace_id env 로 분기.
 *
 * LRU 32 — 같은 프로세스에서 여러 workspace 활성 시 메모리만 관리.
 */

const MAX_OPEN = 32;

function emptyBp(wsId: string, name: string): Blueprint {
  return {
    meta: { id: `bp_${wsId}`, title: name, version: "0.1", rev: 1, workspaceId: wsId },
    nodes: [{ id: "n_root", role: "product", title: name, status: "draft" }],
    edges: [],
  };
}

export class StorePool {
  private cache = new Map<string, BlueprintStorage>();
  private order: string[] = [];
  private backendId: string;

  constructor(
    private dataDir: string,
    private enableAuthz: boolean = true,
  ) {
    this.backendId = getActiveBackendId();
    try {
      mkdirSync(dataDir, { recursive: true });
    } catch {
      /* ignore */
    }
    console.error(`[ubp] StorePool backend=${this.backendId}, data=${dataDir}`);
  }

  /** wsId 의 storage 를 반환. cloud 백엔드는 환경변수 UBP_WORKSPACE_ID 가 단일 워크스페이스 처리. */
  open(wsId: string, displayName?: string): BlueprintStorage {
    const cached = this.cache.get(wsId);
    if (cached) {
      this.touch(wsId);
      return cached;
    }

    let storage: BlueprintStorage;
    const initial = emptyBp(wsId, displayName ?? wsId);
    const authzOpts = this.enableAuthz ? { authz: {} } : {};

    if (this.backendId === "filesystem") {
      // 파일시스템: workspace 별 별도 디렉토리
      const dir = join(this.dataDir, wsId);
      try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
      const path = join(dir, "bp.json");
      storage = createWorkspaceStorage(initial, path, authzOpts);
    } else {
      // 클라우드 백엔드: createStorage 가 환경변수로 인스턴스 생성.
      // 단일 워크스페이스 가정 — 여러 워크스페이스를 한 프로세스에서 다루려면 cloud 어댑터 자체에 인스턴스화 추가 필요.
      throw new Error(
        `백엔드 '${this.backendId}' 는 워크스페이스 단위 동기 open 미지원. ` +
        `cloud 백엔드는 단일 워크스페이스 모드 (UBP_WORKSPACE_ID) 로 createStorage() 호출 필요. ` +
        `또는 백엔드를 'filesystem' 으로 사용.`,
      );
    }

    this.cache.set(wsId, storage);
    this.order.push(wsId);
    this.evictIfNeeded();
    return storage;
  }

  /** 단일 cloud 워크스페이스 부팅 (filesystem 외 백엔드 경로). */
  static async createSingleCloud(initial: Blueprint, opts: { authz?: {} } = {}): Promise<BlueprintStorage> {
    return createStorage(initial, opts);
  }

  private touch(wsId: string): void {
    const idx = this.order.indexOf(wsId);
    if (idx >= 0) this.order.splice(idx, 1);
    this.order.push(wsId);
  }

  private evictIfNeeded(): void {
    while (this.order.length > MAX_OPEN) {
      const oldest = this.order.shift();
      if (oldest) this.cache.delete(oldest);
    }
  }
}
