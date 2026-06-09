# UBP SaaS Server

Express + SQLite + JWT 기반 멀티테넌트 HTTP API.

## 실행

```bash
npm i                # 서버 의존성 포함 설치
npm run build:server # dist/server/ 빌드
JWT_SECRET=$(openssl rand -hex 32) PORT=4173 npm run server
```

dev 모드(별도 빌드 없이):
```bash
npm run server:dev
```

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 4173 | 리스닝 포트 |
| `UBP_DATA_DIR` | `./.ubp-data` | DB·워크스페이스 파일 디렉토리 |
| `UBP_DB_PATH` | `<DATA_DIR>/ubp.sqlite` | SQLite 위치 |
| `JWT_SECRET` | dev fallback | HS256 서명 키 (운영 필수) |

## 빠른 시나리오

```bash
# 1) 회원가입
curl -s -X POST localhost:4173/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"a@a.com","password":"password123"}'
# → { "token": "...", "userId": 1 }

# 2) 워크스페이스 생성
TOKEN=...
curl -s -X POST localhost:4173/workspaces \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Demo"}'
# → { "id": "ws_xxxx", ... }

# 3) 블루프린트 읽기
curl -s -H "Authorization: Bearer $TOKEN" \
  localhost:4173/workspaces/ws_xxxx/blueprint

# 4) propose
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  localhost:4173/workspaces/ws_xxxx/proposals \
  -d '{"intent":"add feature","ops":[{"op":"add_node","node":{"id":"n_a","role":"feature","title":"A","status":"draft","priority":"P0","attrs":{"acceptance_criteria":"AC"}}},{"op":"add_edge","edge":{"from":"n_a","to":"n_root","type":"parent"}}]}'

# 5) confirm
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  localhost:4173/workspaces/ws_xxxx/proposals/p_xxxxxxxx/confirm

# 6) conflicts
curl -s -H "Authorization: Bearer $TOKEN" \
  localhost:4173/workspaces/ws_xxxx/conflicts
```

## 권한 매트릭스

| 엔드포인트 | 최소 role |
|---|---|
| GET blueprint / missing / proposals / audit / snapshots / conflicts / compliance | viewer |
| POST proposals | viewer (propose 는 디폴트로 모두 허용) |
| POST proposals/:id/confirm | editor |
| POST proposals/:id/reject | editor |
| POST snapshots/:sha/restore | owner |
| POST members | owner |

## 데이터 모델

```sql
users         (id, email, password_hash, created_at)
workspaces    (id, name, created_at, owner_id)
memberships   (workspace_id, user_id, role IN owner/editor/viewer)
```

블루프린트 자체는 SQLite가 아니라 `<DATA_DIR>/workspaces/<wsId>/bp.json` (+ audit.jsonl + snapshots/).
이유: 그래프 작업의 단위가 큰 JSON tree 이므로 BlueprintStore 의 WAL·snapshot·audit 메커니즘을 그대로 재사용.

## Postgres 마이그레이션 메모

`server/db.ts` 는 prepared statement 기반이므로 schema 그대로 pg-pool 로 치환 가능. `blob` 대신 `JSONB` 컬럼으로 blueprint 자체를 DB에 옮기는 옵션도 있으나, 첫 운영에서는 파일 기반 유지 권장.
