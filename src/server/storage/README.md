# UBP Storage Backends

UBP는 동일 `BlueprintStorage` 인터페이스 아래 여러 백엔드를 지원한다. 환경 변수 `UBP_BACKEND` 로 선택.

## 백엔드 선택

| 값 | 용도 | 의존성 | 멀티유저 |
|---|---|---|---|
| `filesystem` (기본) | 단일 사용자 / 개발 | `better-sqlite3` (현재 SaaS layer) + `.blueprint/` 디렉토리 | ❌ |
| `supabase` | 클라우드 SaaS | `@supabase/supabase-js` + supabase 프로젝트 | ✅ |
| `postgres` | 자체 호스팅 | `postgres` 또는 `pg` | ✅ |
| `turso` | edge SQLite | `@libsql/client` | ✅ |

## Supabase 설정 (권장 — 멀티유저)

```bash
# 1. 의존성 설치
npm i @supabase/supabase-js

# 2. supabase.sql 적용
# Supabase Dashboard → SQL Editor 에 src/server/storage/supabase.sql 붙여넣고 실행
# 또는: supabase db push (supabase CLI 사용 시)

# 3. 환경 변수
export UBP_BACKEND=supabase
export SUPABASE_URL=https://xxxxx.supabase.co
export SUPABASE_KEY=eyJhbGciOi...  # service_role 키 (서버에서만 사용)

# 4. Storage Bucket (첨부 파일용 — 선택)
# Supabase Dashboard → Storage → 'ubp-attachments' bucket 생성
# Policies 는 supabase.sql 하단 주석 참조

# 5. 실행
npm run build:server && npm run server
```

### Supabase 스키마 핵심
- `workspaces` — 격리 단위
- `memberships` — owner/editor/viewer 권한 매트릭스
- `blueprints` — workspace 당 1 jsonb (의미 그래프 본체)
- `pending_proposals` — confirm gate 대기열
- `audit_entries` — append-only 감사 (RLS: 직접 insert 금지)
- `snapshots` — 롤백 가능 사본
- `attachments` — 본질 5번 첨부 메타 (실파일은 Supabase Storage 또는 외부 URL)

### RLS 요약
- 모든 테이블 RLS enable
- 멤버 아닌 사용자는 select 자체 거부
- viewer: propose 만, editor: confirm/restore 까지, owner: 멤버 관리 + workspace 삭제
- `confirm_proposal(p_id)` SECURITY DEFINER 함수가 atomic 트랜잭션 + 권한 검사

## Postgres (자체 호스팅) 설정

Supabase 스키마에서 RLS 부분 생략하고 application-level authz 만 사용. 클라이언트는 `postgres` (preferred) 또는 `pg`.

```bash
npm i postgres
export UBP_BACKEND=postgres
export DATABASE_URL=postgres://user:pass@host:5432/ubp
```

## Turso (edge SQLite) 설정

```bash
npm i @libsql/client
export UBP_BACKEND=turso
export TURSO_DATABASE_URL=libsql://your-db.turso.io
export TURSO_AUTH_TOKEN=...
```

스키마는 Postgres 와 거의 동일하나 `jsonb` → `text` (JSON.stringify 직렬화).

## FileSystem (기본) — 변경 없이 작동

```bash
# 기본값 — 별도 설정 불필요
npm run mcp   # MCP stdio
npm run server  # SaaS REST + SSE
```

데이터 경로: `<DATA_DIR>/<workspaceId>/{bp.json, audit.jsonl, snapshots/}`

## 첨부(레퍼런스) 저장 모드 (브라우저 측)

서버 백엔드와 독립적으로, 화이트보드 UI에서 **개별 첨부**의 저장 위치 선택 가능 (설정 → 저장·백엔드):

| 모드 | 설명 |
|---|---|
| `inline` | base64 그대로 BP 안에 — 작은 파일·BP 외부 호환 |
| `indexeddb` | 브라우저 IndexedDB 로컬 — 큰 파일·빠른 접근·다른 PC 공유 X |
| `local-fs` | File System Access API — Chrome/Edge, 사용자가 디렉토리 지정 |
| `url` | 외부 호스팅 URL — Supabase Storage / S3 / R2 등에 사용자가 직접 업로드 |

저장 모드는 어떤 백엔드를 쓰든 동일하게 동작 (BP 의 `attachment.url` 에 ref 형식 `@idb:...`, `@fs:...`, `https://...` 가 저장됨).
