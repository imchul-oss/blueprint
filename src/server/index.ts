import express from "express";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { DB } from "./db.js";
import {
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth,
  requireMembership,
  type AuthedRequest,
} from "./auth.js";
import { StorePool } from "./store-pool.js";
import { findConflicts, formatConflicts } from "../core/conflict.js";
import { detectMissing, missingToClarify } from "../core/missing.js";
import { computeCompliance } from "../core/compliance.js";
import { orchestrate } from "../core/orchestrator.js";
import type { BlueprintOp } from "../core/ops.js";
import type { ActorRole } from "../core/types.js";

/**
 * UBP SaaS HTTP API.
 *
 * 엔드포인트:
 *   POST /auth/register           { email, password }       → { token }
 *   POST /auth/login              { email, password }       → { token }
 *   GET  /workspaces                                        → list (auth)
 *   POST /workspaces              { name }                  → ws (auth, 생성자 = owner)
 *   POST /workspaces/:wsId/members { userId, role }         → 200 (owner)
 *
 *   GET  /workspaces/:wsId/blueprint                        → bp (viewer+)
 *   GET  /workspaces/:wsId/missing                          → clarify list (viewer+)
 *   POST /workspaces/:wsId/proposals { ops, intent, baseRev } → proposal (viewer+ = propose 권한 디폴트)
 *   GET  /workspaces/:wsId/proposals                        → pending list (viewer+)
 *   POST /workspaces/:wsId/proposals/:pid/confirm           → applied (editor+)
 *   POST /workspaces/:wsId/proposals/:pid/reject            → ok (editor+)
 *   GET  /workspaces/:wsId/conflicts                        → conflict pairs (viewer+)
 *   GET  /workspaces/:wsId/audit?n=N                        → audit tail (viewer+)
 *   GET  /workspaces/:wsId/snapshots                        → list (viewer+)
 *   POST /workspaces/:wsId/snapshots/:sha/restore           → ok (owner)
 *   GET  /workspaces/:wsId/compliance                       → stats (viewer+)
 */

const DATA_DIR = process.env.UBP_DATA_DIR ?? "./.ubp-data";
const DB_PATH = process.env.UBP_DB_PATH ?? `${DATA_DIR}/ubp.sqlite`;
const PORT = Number(process.env.PORT ?? 4173);

const db = new DB(DB_PATH);
const pool = new StorePool(`${DATA_DIR}/workspaces`, true);

const app = express();
app.use(express.json({ limit: "2mb" }));

// ============ Auth ============
app.post("/auth/register", async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "email_and_password_required (min 8)" });
  }
  if (db.findUserByEmail(email)) return res.status(409).json({ error: "email_taken" });
  const hash = await hashPassword(password);
  const user = db.createUser(email, hash);
  return res.json({ token: signToken(user), userId: user.id });
});

app.post("/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  const user = db.findUserByEmail(email);
  if (!user) return res.status(401).json({ error: "invalid_credentials" });
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });
  return res.json({ token: signToken(user), userId: user.id });
});

// ============ Workspaces ============
app.get("/workspaces", requireAuth, (req: AuthedRequest, res: Response) => {
  return res.json(db.listWorkspacesForUser(req.user!.id));
});

app.post("/workspaces", requireAuth, (req: AuthedRequest, res: Response) => {
  const { name } = req.body ?? {};
  if (typeof name !== "string" || name.length === 0) return res.status(400).json({ error: "name_required" });
  const wsId = `ws_${randomUUID().slice(0, 8)}`;
  db.createWorkspace(wsId, name, req.user!.id);
  pool.open(wsId, name); // prime store
  return res.json({ id: wsId, name });
});

app.post(
  "/workspaces/:wsId/members",
  requireAuth,
  requireMembership(db, "owner"),
  (req: AuthedRequest, res: Response) => {
    const { userId, role } = req.body ?? {};
    if (typeof userId !== "number" || !["owner", "editor", "viewer"].includes(role)) {
      return res.status(400).json({ error: "invalid_member" });
    }
    db.addMember(req.params.wsId, userId, role as ActorRole);
    return res.json({ ok: true });
  },
);

// ============ Blueprint per workspace ============
const ws = (req: AuthedRequest) => pool.open(req.params.wsId);

app.get(
  "/workspaces/:wsId/blueprint",
  requireAuth,
  requireMembership(db, "viewer"),
  (req: AuthedRequest, res: Response) => {
    return res.json(ws(req).get());
  },
);

app.get(
  "/workspaces/:wsId/missing",
  requireAuth,
  requireMembership(db, "viewer"),
  (req: AuthedRequest, res: Response) => {
    const reports = detectMissing(ws(req).get());
    return res.json({ reports, clarify: missingToClarify(reports) });
  },
);

app.post(
  "/workspaces/:wsId/proposals",
  requireAuth,
  requireMembership(db, "viewer"),
  (req: AuthedRequest, res: Response) => {
    const { ops, intent, baseRev } = req.body ?? {};
    if (!Array.isArray(ops) || typeof intent !== "string") {
      return res.status(400).json({ error: "ops_and_intent_required" });
    }
    const role = (req as AuthedRequest & { role: ActorRole }).role;
    const p = ws(req).propose(ops as BlueprintOp[], intent, {
      actor: { id: String(req.user!.id), role },
      baseRev: typeof baseRev === "number" ? baseRev : undefined,
    });
    return res.json(p);
  },
);

app.get(
  "/workspaces/:wsId/proposals",
  requireAuth,
  requireMembership(db, "viewer"),
  (req: AuthedRequest, res: Response) => {
    return res.json(ws(req).listPending());
  },
);

app.post(
  "/workspaces/:wsId/proposals/:pid/confirm",
  requireAuth,
  requireMembership(db, "editor"),
  (req: AuthedRequest, res: Response) => {
    const role = (req as AuthedRequest & { role: ActorRole }).role;
    const r = ws(req).confirm(req.params.pid, { actor: { id: String(req.user!.id), role } });
    if (!r) return res.status(409).json({ error: "rejected_or_missing" });
    return res.json(r);
  },
);

app.post(
  "/workspaces/:wsId/proposals/:pid/reject",
  requireAuth,
  requireMembership(db, "editor"),
  (req: AuthedRequest, res: Response) => {
    const ok = ws(req).reject(req.params.pid, {
      actor: String(req.user!.id),
      reason: req.body?.reason,
    });
    return res.json({ ok });
  },
);

app.get(
  "/workspaces/:wsId/conflicts",
  requireAuth,
  requireMembership(db, "viewer"),
  (req: AuthedRequest, res: Response) => {
    const pairs = findConflicts(ws(req).listPending());
    return res.json({ count: pairs.length, pairs, summary: formatConflicts(pairs) });
  },
);

app.get(
  "/workspaces/:wsId/audit",
  requireAuth,
  requireMembership(db, "viewer"),
  async (req: AuthedRequest, res: Response) => {
    const n = Number(req.query.n ?? 50);
    const s = ws(req);
    const audit = s.tailAuditAsync ? await s.tailAuditAsync(n) : s.tailAudit(n);
    return res.json(audit);
  },
);

app.get(
  "/workspaces/:wsId/snapshots",
  requireAuth,
  requireMembership(db, "viewer"),
  async (req: AuthedRequest, res: Response) => {
    const s = ws(req);
    const snaps = s.listSnapshotsAsync ? await s.listSnapshotsAsync() : s.listSnapshots();
    return res.json(snaps);
  },
);

app.post(
  "/workspaces/:wsId/snapshots/:sha/restore",
  requireAuth,
  requireMembership(db, "owner"),
  (req: AuthedRequest, res: Response) => {
    const role = (req as AuthedRequest & { role: ActorRole }).role;
    const r = ws(req).restore(req.params.sha, { actor: { id: String(req.user!.id), role } });
    if (!r) return res.status(404).json({ error: "snapshot_not_found_or_forbidden" });
    return res.json(r);
  },
);

app.get(
  "/workspaces/:wsId/compliance",
  requireAuth,
  requireMembership(db, "viewer"),
  (req: AuthedRequest, res: Response) => {
    const windowMs = Number(req.query.windowMs ?? 5 * 60 * 1000);
    return res.json(computeCompliance(ws(req).tailAudit(10_000), windowMs));
  },
);

// AI propose — natural language → ops 변환
app.post(
  "/workspaces/:wsId/ai-propose",
  requireAuth,
  requireMembership(db, "viewer"),
  (req: AuthedRequest, res: Response) => {
    const { prompt } = req.body ?? {};
    if (typeof prompt !== "string" || !prompt.trim()) return res.status(400).json({ error: "prompt_required" });
    const r = orchestrate(prompt);
    if (r.ops.length === 0) return res.status(422).json({ error: "parse_failed", prompt, confidence: r.confidence });
    const role = (req as AuthedRequest & { role: ActorRole }).role;
    const p = ws(req).propose(r.ops, r.intent, { actor: { id: String(req.user!.id), role } });
    return res.json({ proposal: p, confidence: r.confidence });
  },
);

// SSE stream — BlueprintStorage 이벤트를 실시간 push.
// 백엔드 무관 통일: filesystem 은 local store.on() 만, Supabase 는 Postgres Realtime 이 SupabaseStorage.on() 으로 들어와 자동 브리지.
// 즉 이 endpoint 는 백엔드 교체에도 코드 변경 없이 동작.
app.get(
  "/workspaces/:wsId/events",
  requireAuth,
  requireMembership(db, "viewer"),
  (req: AuthedRequest, res: Response) => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`event: hello\ndata: {"ts":${Date.now()},"rev":${ws(req).rev()}}\n\n`);
    const unsubscribe = ws(req).on((e) => {
      // e.actor === "remote" 면 Supabase Realtime 에서 들어온 원격 변경 (다른 클라이언트 confirm)
      res.write(`event: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`);
    });
    // heartbeat (keep proxies from timing out)
    const hb = setInterval(() => res.write(`: heartbeat\n\n`), 25_000);
    req.on("close", () => {
      clearInterval(hb);
      unsubscribe();
    });
  },
);

// Health
app.get("/health", (_req: Request, res: Response) => res.json({ ok: true, version: "0.2.0" }));

// Boot
app.listen(PORT, () => {
  console.log(`[ubp-server] listening on :${PORT} (data=${DATA_DIR})`);
});
