import type { Blueprint } from "../../core/types.js";
import type { BlueprintStorage, StorageBackendModule, StorageOptions } from "./interface.js";

/**
 * PostgresStorage — 자체 호스팅 Postgres (pg 또는 postgres.js).
 * 스키마는 supabase.sql 의 RLS 제외 부분과 동일.
 * 사용:
 *   1) npm i postgres
 *   2) UBP_BACKEND=postgres DATABASE_URL=postgres://... npm run server
 *   3) 본 모듈의 TODO 주석을 채워 pg/postgres 호출
 */
export const postgresBackend: StorageBackendModule = {
  id: "postgres",
  async create(_initial: Blueprint, _opts: StorageOptions = {}): Promise<BlueprintStorage> {
    throw new Error(
      "postgresBackend.create: 구현 미완료 — supabase.ts 를 참조해 같은 패턴으로 구현. " +
      "RLS 없이 application-level authz 만 적용.",
    );
  },
};
