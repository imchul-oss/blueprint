import { filesystemBackend, makeFileSystemStorage } from "./filesystem.js";
import { supabaseBackend } from "./supabase.js";
import { postgresBackend } from "./postgres.js";
import { tursoBackend } from "./turso.js";
import type { BlueprintStorage, StorageBackendModule, StorageOptions } from "./interface.js";
import type { Blueprint } from "../../core/types.js";

/**
 * 백엔드 레지스트리. UBP_BACKEND 환경 변수로 선택.
 *
 * 기본값: filesystem (단일 사용자/개발).
 * 운영: supabase / postgres / turso 중 택1.
 */
const REGISTRY: Record<string, StorageBackendModule> = {
  filesystem: filesystemBackend,
  supabase: supabaseBackend,
  postgres: postgresBackend,
  turso: tursoBackend,
};

export function getActiveBackendId(): string {
  return process.env.UBP_BACKEND || "filesystem";
}

export async function createStorage(
  initial: Blueprint,
  opts: StorageOptions = {},
): Promise<BlueprintStorage> {
  const id = getActiveBackendId();
  const mod = REGISTRY[id];
  if (!mod) throw new Error(`Unknown UBP_BACKEND: ${id}. Available: ${Object.keys(REGISTRY).join(", ")}`);
  return mod.create(initial, opts);
}

/** workspace 단위 storage — 현재 filesystem 만 지원 (멀티유저 백엔드는 SupabaseStorage 등이 자체 워크스페이스 격리). */
export function createWorkspaceStorage(
  initial: Blueprint,
  workspacePath: string,
  opts: StorageOptions = {},
): BlueprintStorage {
  const id = getActiveBackendId();
  if (id === "filesystem") return makeFileSystemStorage(initial, workspacePath, opts);
  throw new Error(
    `백엔드 '${id}' 는 워크스페이스 단위 인스턴스 생성을 직접 지원하지 않음. ` +
    `대신 SupabaseStorage 등이 workspace_id 로 격리 — store-pool 대체 필요.`,
  );
}

export type { BlueprintStorage, StorageBackendModule, StorageOptions } from "./interface.js";
