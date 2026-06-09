# Implementation Plan: MCP-로컬 사용 기준 검증·하드닝 패스

## Overview
사용자는 UBP를 **REST API/SaaS가 아니라 MCP 형태로 (로컬 포함) 사용**한다. 코드 확인 결과 **MCP 로컬 사용은 가능**하다 — `mcp-server.ts`가 `BlueprintStore`(store.ts)를 **직접** 쓰고 **stdio** 트랜스포트 + **로컬 파일시스템 스토어**(`UBP_STORE ?? .blueprint/bp.json`)로 동작하며, **네트워크/Supabase/REST 서버가 전혀 필요 없다**. 따라서 하드닝의 초점을 **MCP 도구 표면 + store/core**로 재조정한다. Supabase/postgres/turso 어댑터와 REST 서버(src/server/index.ts)는 **SaaS 멀티유저 경로**로, 이번 MCP-로컬 패스의 **범위 밖**이다.

## MCP-로컬 가능 근거 (실측 2026-06-10)
- `dist/test-mcp-e2e.js`가 `node dist/mcp-server.js`를 stdio로 spawn → `listTools`(20개) → `read_blueprint`/`propose_update` 라운드트립 성공. 외부 네트워크 0.
- `mcp-server.ts:6,32` → `new BlueprintStore(ubpSelf, STORE_PATH)`, `STORE_PATH=UBP_STORE ?? ".blueprint/bp.json"`. 스토리지 어댑터 레이어 미사용.
- 등록 예(BLUEPRINT.md §13): `{ "command":"node","args":["dist/mcp-server.js"],"env":{"UBP_STORE":".blueprint/bp.json","UBP_POLICY":"BLUEPRINT.md"} }`.

## 베이스라인 (실측)
| 표면 | 상태 | 비고 |
|---|---|---|
| build (`node node_modules/typescript/bin/tsc`) | ✅ EXIT 0 | `npm run build`는 셸 PATH quirk로만 실패 |
| `npm run smoke` | ✅ 24/24 | core 로직, env-independent |
| `dist/test-mcp-logic.js` (SDK-less) | ✅ 7/7 | **단, npm 스크립트 미연결(orphan)** |
| `dist/test-mcp-e2e.js` (real stdio) | ⚠️ **false-green** | confirm 단계 regex `(p_\d+)`가 hex ID `p_a625f0db` 불일치 → `confirm_update("")` no-op, 그래도 exit 0 |
| MCP 20개 도구 | ⚠️ 3개만 e2e | 17개 도구표면 무검증 |
| `npm test` (vitest) | ❌ rollup native 누락 | env 이슈, smoke가 대체 |
| Supabase/postgres/turso 어댑터 | — | **범위 밖** (REST/SaaS 경로) |

## Architecture Decisions
- **하드닝 초점 = MCP 경로**: `mcp-server.ts`(도구 20개) + `store.ts` + `core/*`. 전부 node·env-independent.
- **MCP 테스트를 npm 스크립트로 연결**: `test:mcp`(logic, SDK-less) + `test:mcp:e2e`(build→spawn). 지금은 orphan이라 회귀가 자동으로 안 잡힌다.
- **store.ts/core는 이미 smoke 24/24 커버** → 신규 작업은 MCP **도구 표면**(미검증 17개)과 **e2e false-green 수정**에 집중.
- **Supabase/REST는 범위 밖**: MCP-로컬 사용과 무관. 이전 계획의 Supabase 하드닝 태스크는 폐기.
- **브라우저(GUI)는 별개 축**: 화이트보드는 사람 저작 도구 — MCP 소비와 직교하나 사이클 1–4 산출이므로 회귀 검증 유지(agent-browser `ubp-debug`). FS-Access 다이얼로그는 자동화 불가 → 수동 레시피 분리.

## Task List

### Phase 0: 하네스 기반 (fail-fast)
- [ ] **T0: MCP 테스트 npm 연결 + 베이스라인 확정**

### Checkpoint: Foundation
- [ ] `npm run test:mcp` / `test:mcp:e2e`가 도는 명령으로 존재, smoke 그린

### Phase 1: MCP 도구 표면 하드닝 (node)
- [ ] **T1: e2e false-green confirm 수정 + 로컬 MCP 증명**
- [ ] **T2: MCP 도구 표면 커버리지 확장 (미검증 17개 중 핵심)**

### Checkpoint: MCP
- [ ] e2e가 confirm 실제 반영을 hard-assert, 핵심 도구 라운드트립 그린

### Phase 2: 프런트엔드(GUI) 회귀 (browser, agent-browser)
- [ ] **T3: JSON Canvas 라운드트립 + properties 매핑** (사이클1)
- [ ] **T4: 첨부 저장 4모드 ref·다운그레이드** (사이클2)
- [ ] **T5: anchor scan 파싱 + UI 폴리시 회귀** (사이클3·4)

### Checkpoint: Complete
- [ ] MCP-로컬 경로 검증 그린 + GUI 회귀 경로 확보(자동 or 명시적 수동 레시피)

---

## Task 0: MCP 테스트 npm 연결 + 베이스라인 확정
**Description:** orphan 상태인 두 MCP 테스트를 npm 스크립트로 연결한다. `test:mcp`(=`tsx src/test-mcp-logic.ts` 또는 컴파일본), `test:mcp:e2e`(=build 후 `node dist/test-mcp-e2e.js`). build/smoke 그린 확인, README에 로컬 MCP 실행·검증 명령 1줄 추가.
**Acceptance criteria:**
- [ ] `package.json`에 `test:mcp`, `test:mcp:e2e` 스크립트 추가
- [ ] `npm run test:mcp` 그린(7/7), `npm run test:mcp:e2e` 실행됨
- [ ] README에 로컬 MCP 등록·검증 명령 반영
**Verification:** `npm run test:mcp` 7/7 · `npm run smoke` 24/24 · build EXIT 0
**Dependencies:** None · **Files:** `package.json`, `README.md` · **Scope:** S

## Task 1: e2e false-green confirm 수정 + 로컬 MCP 증명
**Description:** `test-mcp-e2e.ts`의 proposalId 추출 regex `(p_\d+)`가 실제 hex ID(`p_a625f0db`)와 불일치 → `confirm_update("")`가 no-op인데도 테스트가 exit 0. regex를 `p_\w+`로 고치고, **confirm 후 n_demo 반영을 hard-assert**(미반영 시 exit 1)로 바꾼다. 네트워크 0 + 파일시스템 스토어 동작을 명시 검증.
**Acceptance criteria:**
- [ ] proposalId가 hex ID를 정확히 캡처
- [ ] confirm_update 후 read_blueprint에 n_demo 존재 → 아니면 exit 1 (false-green 제거)
- [ ] 임시 `UBP_STORE`(temp 경로) 사용해 실 `.blueprint` 비오염
**Verification:** `npm run test:mcp:e2e` → 의도적으로 regex 되돌리면 RED, 수정본은 GREEN
**Dependencies:** T0 · **Files:** `src/test-mcp-e2e.ts` · **Scope:** S

## Task 2: MCP 도구 표면 커버리지 확장
**Description:** e2e가 20개 중 3개만 호출. stdio 클라이언트로 핵심 미검증 도구를 호출·검증: `get_policy`(정책 JSON), `get_missing`, `list_pending`, `reject_update`, `tail_audit`, `list_snapshots`+`restore_snapshot`(라운드트립), `scan_code_anchors`, `list_conflicts`, `compliance_stats`, `propose_from_prompt`, `get_harness`. 각 도구 sane 출력 + 상태전이 hard-assert.
**Acceptance criteria:**
- [ ] 위 도구 호출 시 에러 없이 의미있는 응답
- [ ] snapshot→restore 라운드트립이 rev/상태 복구를 검증
- [ ] reject_update 후 list_pending에서 제거 확인
- [ ] 실패 시 exit 1
**Verification:** `npm run test:mcp:e2e` 확장 블록 그린, 네트워크 0
**Dependencies:** T1 · **Files:** `src/test-mcp-e2e.ts`(또는 `src/test-mcp-tools.ts` 신규) · **Scope:** M

## Task 3: JSON Canvas 라운드트립 + properties 매핑 (사이클1)
**Description:** agent-browser `ubp-debug` eval로 `exportJsonCanvas`↔`jsonCanvasToBP` 라운드트립 검증. BP→canvas→BP 구조 동치 + Obsidian frontmatter/Dataview properties→attrs + section frame 매핑.
**Acceptance criteria:**
- [ ] export→import 후 노드 수·엣지 from/to·role 보존
- [ ] frontmatter/dataview properties가 `node.attrs.<key>`로 매핑
- [ ] section role + `attrs.frame` 매핑
**Verification:** eval 어서션 통과, 레시피 `tasks/browser-verify.md` 저장
**Dependencies:** T0(병렬 가능) · **Files:** `tasks/browser-verify.md` · **Scope:** S

## Task 4: 첨부 저장 4모드 ref·다운그레이드 (사이클2)
**Description:** inline/idb(`@idb:`)/url ref 포맷 자동 검증 + >10MB inline→idb 다운그레이드. local-fs(`showSaveFilePicker`, user-gesture)는 수동 레시피로 분리.
**Acceptance criteria:**
- [ ] inline→base64, idb→`@idb:<id>`, url→외부 URL ref 자동 검증
- [ ] >10MB+inline → idb 다운그레이드 (whiteboard.html ~5757)
- [ ] local-fs 수동 단계 명시(통과 위장 금지)
**Verification:** eval 어서션, 수동 단계 `tasks/browser-verify.md` 기재
**Dependencies:** T3 · **Files:** `tasks/browser-verify.md` · **Scope:** M

## Task 5: anchor scan 파싱 + UI 폴리시 회귀 (사이클3·4)
**Description:** anchor 마커 파싱 fixture 자동 검증(`showDirectoryPicker`는 수동) + 이번 세션 UI(collapse 핸들 flush·writing 템플릿) 회귀 고정.
**Acceptance criteria:**
- [ ] 마커 fixture → file 노드 + traces-to (자동)
- [ ] directory-picker 수동 레시피
- [ ] collapse 핸들 14×32·flush(|gap|<1.5px)·opacity0; writing/novel/essay/sns 노드수 11/22/14/17
- [ ] 스크린샷 1장
**Verification:** eval+screenshot, 레시피 저장
**Dependencies:** T4 · **Files:** `tasks/browser-verify.md` · **Scope:** M

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| vitest 미실행(rollup native) | Med | smoke + MCP 스크립트로 대체(전부 env-independent) |
| e2e가 또 false-green | High | confirm 반영을 hard-assert + 의도적 RED 재현으로 검증 |
| FS-Access 자동화 불가 | Med | 파싱만 자동, 다이얼로그는 수동 레시피 분리·명시 |
| 테스트가 `.blueprint` 오염 | Med | 임시 `UBP_STORE` 사용 |

## Open Questions / 범위 밖
- Supabase/postgres/turso 어댑터 + REST 서버 하드닝 = **SaaS 경로, 이번 패스 제외**(MCP-로컬과 무관). 추후 SaaS 배포 시 별도 패스.
- vitest 복구(`npm run repair`) — best-effort, 차단 요인 아님.
