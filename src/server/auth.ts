import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import type { DB, UserRow } from "./db.js";

/**
 * 인증 — bcrypt(비번 해시) + JWT(HS256) 미들웨어.
 *
 * 개발 환경에선 JWT_SECRET 환경변수가 없으면 일회용 시크릿이 자동 생성된다(프로세스 재시작 시 무효화).
 * 운영에서는 반드시 JWT_SECRET 을 명시 설정.
 */

const TTL = "12h";

function getSecret(): string {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 16) return s;
  // dev fallback
  const cached = (globalThis as Record<string, unknown>).__ubp_dev_secret as string | undefined;
  if (cached) return cached;
  const generated = "dev-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  (globalThis as Record<string, unknown>).__ubp_dev_secret = generated;
  console.error("[ubp] WARN: JWT_SECRET 미설정 — 일회용 dev 시크릿 사용 중. 운영 환경에선 설정 필수.");
  return generated;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(user: UserRow): string {
  return jwt.sign({ sub: user.id, email: user.email }, getSecret(), { expiresIn: TTL });
}

export interface AuthedRequest extends Request {
  user?: { id: number; email: string };
}

/** Bearer 토큰 또는 ?token=… query 검증 미들웨어 (SSE 호환). */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const h = req.header("authorization");
  const queryToken = (req as AuthedRequest & { query: { token?: string } }).query.token;
  let token: string | undefined;
  if (h && h.startsWith("Bearer ")) token = h.slice("Bearer ".length);
  else if (typeof queryToken === "string" && queryToken.length > 0) token = queryToken;
  if (!token) {
    res.status(401).json({ error: "missing_token" });
    return;
  }
  try {
    const payload = jwt.verify(token, getSecret()) as { sub: number; email: string };
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}

/** 워크스페이스 멤버십 확인 미들웨어 팩토리. */
export function requireMembership(db: DB, minRole: "owner" | "editor" | "viewer" = "viewer") {
  const order = { viewer: 0, editor: 1, owner: 2 };
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "missing_token" });
      return;
    }
    const wsId = req.params.wsId;
    const m = db.getMembership(wsId, req.user.id);
    if (!m) {
      res.status(403).json({ error: "not_a_member" });
      return;
    }
    if (order[m.role] < order[minRole]) {
      res.status(403).json({ error: "insufficient_role", required: minRole, got: m.role });
      return;
    }
    (req as AuthedRequest & { role: string }).role = m.role;
    next();
  };
}
