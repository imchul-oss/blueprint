import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * SaaS 백엔드 SQLite 스키마.
 * dev 친화성을 위해 SQLite 사용. 운영은 같은 SQL 로 Postgres 마이그레이션 가능
 * (better-sqlite3 → pg). 트랜잭션·prepared statement 패턴 그대로.
 */

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  created_at: number;
}

export interface WorkspaceRow {
  id: string; // ws_xxxx
  name: string;
  created_at: number;
  owner_id: number;
}

export interface MembershipRow {
  workspace_id: string;
  user_id: number;
  role: "owner" | "editor" | "viewer";
}

export class DB {
  private db: Database.Database;

  constructor(path: string) {
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {
      /* ignore */
    }
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        owner_id INTEGER NOT NULL REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS memberships (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
        PRIMARY KEY (workspace_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
    `);
  }

  // === Users ===
  createUser(email: string, passwordHash: string): UserRow {
    const now = Date.now();
    const r = this.db
      .prepare(`INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)`)
      .run(email, passwordHash, now);
    return { id: r.lastInsertRowid as number, email, password_hash: passwordHash, created_at: now };
  }

  findUserByEmail(email: string): UserRow | undefined {
    return this.db
      .prepare(`SELECT * FROM users WHERE email = ?`)
      .get(email) as UserRow | undefined;
  }

  // === Workspaces ===
  createWorkspace(id: string, name: string, ownerId: number): WorkspaceRow {
    const now = Date.now();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(`INSERT INTO workspaces (id, name, created_at, owner_id) VALUES (?, ?, ?, ?)`)
        .run(id, name, now, ownerId);
      this.db
        .prepare(
          `INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, 'owner')`,
        )
        .run(id, ownerId);
    });
    tx();
    return { id, name, created_at: now, owner_id: ownerId };
  }

  listWorkspacesForUser(userId: number): (WorkspaceRow & { role: MembershipRow["role"] })[] {
    return this.db
      .prepare(
        `SELECT w.*, m.role
         FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
         WHERE m.user_id = ?
         ORDER BY w.created_at DESC`,
      )
      .all(userId) as (WorkspaceRow & { role: MembershipRow["role"] })[];
  }

  getMembership(workspaceId: string, userId: number): MembershipRow | undefined {
    return this.db
      .prepare(`SELECT * FROM memberships WHERE workspace_id = ? AND user_id = ?`)
      .get(workspaceId, userId) as MembershipRow | undefined;
  }

  addMember(workspaceId: string, userId: number, role: MembershipRow["role"]): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)`)
      .run(workspaceId, userId, role);
  }
}
