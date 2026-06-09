import { BlueprintStore } from "../../store.js";
import type { Blueprint } from "../../core/types.js";
import type { BlueprintStorage, StorageOptions, StorageBackendModule } from "./interface.js";

/**
 * 기존 BlueprintStore (파일 시스템) 를 BlueprintStorage 인터페이스로 어댑트.
 * 파일 구조: <DATA_DIR>/<wsId>/{bp.json, audit.jsonl, snapshots/}
 */
class FileSystemStorage implements BlueprintStorage {
  readonly backend = "filesystem" as const;
  private store: BlueprintStore;
  constructor(initial: Blueprint, path: string, opts: StorageOptions = {}) {
    this.store = new BlueprintStore(initial, path, opts);
  }
  get() { return this.store.get(); }
  rev() { return this.store.rev(); }
  propose(...args: Parameters<BlueprintStore["propose"]>) { return this.store.propose(...args); }
  confirm(...args: Parameters<BlueprintStore["confirm"]>) { return this.store.confirm(...args); }
  reject(...args: Parameters<BlueprintStore["reject"]>) { return this.store.reject(...args); }
  listPending() { return this.store.listPending(); }
  tailAudit(n?: number) { return this.store.tailAudit(n); }
  async tailAuditAsync(n?: number) { return this.store.tailAudit(n); }
  listSnapshots() { return this.store.listSnapshots(); }
  async listSnapshotsAsync() { return this.store.listSnapshots(); }
  restore(...args: Parameters<BlueprintStore["restore"]>) { return this.store.restore(...args); }
  on(handler: Parameters<BlueprintStore["on"]>[0]) { return this.store.on(handler); }
}

export const filesystemBackend: StorageBackendModule = {
  id: "filesystem",
  async create(initial: Blueprint, opts: StorageOptions = {}): Promise<BlueprintStorage> {
    const path = process.env.UBP_STORE ?? ".blueprint/bp.json";
    return new FileSystemStorage(initial, path, opts);
  },
};

/** workspace 단위 storage 인스턴스 — store-pool 에서 호출. */
export function makeFileSystemStorage(initial: Blueprint, path: string, opts: StorageOptions = {}): BlueprintStorage {
  return new FileSystemStorage(initial, path, opts);
}
