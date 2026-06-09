import type { Blueprint } from "../../core/types.js";
import type { BlueprintStorage, StorageBackendModule, StorageOptions } from "./interface.js";

/**
 * TursoStorage — SQLite 호환 cloud (libSQL).
 * better-sqlite3 와 거의 동일 API + edge-replica.
 * 사용:
 *   1) npm i @libsql/client
 *   2) UBP_BACKEND=turso TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run server
 *   3) supabase.sql 의 RLS 제외 + sqlite-호환 컬럼 타입(BLOB 등) 으로 적용
 */
export const tursoBackend: StorageBackendModule = {
  id: "turso",
  async create(_initial: Blueprint, _opts: StorageOptions = {}): Promise<BlueprintStorage> {
    throw new Error(
      "tursoBackend.create: 구현 미완료 — supabase.ts 의 SupabaseStorage 패턴을 libSQL 클라이언트로 치환.",
    );
  },
};
