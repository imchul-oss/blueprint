# Implementation Plan: 설정 기반 단일 store 통합 (옵션 2 + 옵션 3, 자동 강등)

## 목표 (사용자 의도)
웹 GUI와 MCP가 **같은 단일 진실원천**을 보게 한다. 모드는 *설정 존재 여부*로 자동 결정한다.

- **Supabase 미설정 → 옵션 2 (로컬 파일)**: 웹과 MCP가 같은 `.blueprint/bp.json`을 공유.
- **Supabase 설정 → 옵션 3 (클라우드)**: 웹과 MCP가 같은 Supabase `blueprints` 행을 공유. 멀티 기기 양방향.
- 둘 다 아니면 **tier 0 (이 브라우저만)**: localStorage. "html만 열면 됨" 기본 동작 보존.
- **신규 사용자 혼란 방지가 1급 요구사항**: 활성 store를 항상 *눈에 보이게 + 자가설명*. 침묵 전환·침묵 덮어쓰기 금지.

## 현재 코드 실측 (2026-06-10)
- 웹 저장: `saveBP`/`loadBP`(whiteboard.html ~2232/2257) = **localStorage `ubp_bp`**. Supabase는 `saveBPToCloud`/`loadBPFromCloud`(~2290) **raw upsert**(rev-lock·confirm 게이트 없음, last-writer-wins). `?api=&ws=&token=` SSE/poll(~8128)은 **읽기 인지만**("새로고침 필요" 토스트), 쓰기 안 함.
- MCP: `src/mcp-server.ts` → `new BlueprintStore(initial, UBP_STORE)` 파일 직결. `src/store.ts`는 **생성자에서 파일 1회 읽고 메모리 보유** → 외부(웹)가 파일을 고쳐도 안 봄.
- **이미 존재(옵션 3 토대 ~80%)**: `src/server/index.ts`(인증·workspace·proposals/confirm·SSE·compliance HTTP API), `src/server/storage/{interface,index,filesystem,supabase,postgres,turso}.ts`(`UBP_BACKEND`로 교체), `SupabaseStorage`(Realtime 구독+rev-lock confirm 구현됨). `createStorage()` 팩토리도 있음.
- 빠진 것: (1) 웹이 서버/클라우드/공유파일로 **쓰기**를 안 함, (2) MCP가 `createStorage()`(backend-resolved)를 안 거침 + 외부 파일 변경 재읽기 없음.

## 아키텍처 결정
1. **config-driven 해석(라우트 Y) 채택. 상시 HTTP 서버 강제 안 함.** "html 열면 동작"하는 local-first 정체성 보존 — 신규 사용자가 서버를 띄울 필요 없음. `src/server/*`는 옵션 3의 *선택적* 멀티유저 경로로 유지(이번 범위에서 필수 아님). 옵션 3 최단 경로는 웹·MCP가 **동일 Supabase 행 직접 공유**(SupabaseStorage가 이미 그 계약을 구현).
2. **웹에 `StoreAdapter` 단일 인터페이스 도입**: `load() / save(bp, baseRev) / subscribe(onRemote) / info()`. 3 구현: `LocalStore`(localStorage), `FileStore`(File System Access → bp.json), `CloudStore`(Supabase, rev-lock + Realtime). 기존 `saveBP/loadBP`를 이 어댑터 뒤로 라우팅.
3. **단일 진실원천 불변식**: 동시에 정확히 하나의 store만 authoritative. 동시 이중 쓰기 금지(클라우드 활성 시 localStorage는 *읽기전용 오프라인 캐시*로만, 명시 표시). 티어 전환 = 명시적 migrate(현재 BP → 새 store seed) + confirm.
4. **rev 낙관락을 모든 쓰기 경로에 통일**: 저장 직전 현재 store rev 재확인 → baseRev 불일치면 중단 + 분기/머지 다이얼로그(기존 merge-modal 재사용). 침묵 덮어쓰기 금지.
5. **MCP 외부 변경 재읽기**: `BlueprintStore`에 파일 mtime/rev 가드 추가 — get/propose/confirm 직전 파일이 외부에서 바뀌었으면 재로드. 옵션 2 양방향의 필수 조건.

## 의존 그래프
```
A (계약·resolver 스켈레톤)
├─→ B (옵션 2 수직: 웹 FileStore + MCP mtime 재읽기)   ← Supabase 불필요, 단독 출고 가능
├─→ C (옵션 3 수직: 웹 CloudStore live + MCP supabase backend 결선 + 스키마)
│      (MCP측은 B와 독립 / e2e는 웹+MCP 둘 다 필요)
└─→ D (resolver 확정 + 상태 배지 + 온보딩 + 분기/migrate 다이얼로그)  ← B·C 어댑터 의존
        └─→ E (문서: BLUEPRINT.md 3-티어 · README 셋업 · MCP env)
```

## Task List

### Phase A: store 계약 + resolver 스켈레톤
- [ ] **TA1** `StoreAdapter` 인터페이스 + 3 구현 stub + `resolveStore()`(설정→티어) + UI 상태 모델

### Checkpoint A
- [ ] 기존 동작 무회귀(localStorage 경로가 LocalStore로 흘러도 smoke·GUI 정상), resolveStore가 3티어 정확 판정

### Phase B: 옵션 2 — 로컬 파일 공유 (수직)
- [ ] **TB1** 웹 `FileStore`: File System Access로 `.blueprint/bp.json` read/write + 핸들 IndexedDB 영속 + 권한 재요청
- [ ] **TB2** rev-lock 저장 + audit.jsonl append + snapshots/ 기록(MCP 디시플린 동등) + 원자적 swap
- [ ] **TB3** MCP `BlueprintStore` 외부 파일 변경 재읽기(mtime/rev 가드)
- [ ] **TB4** 웹 focus/visibility + 주기 폴링으로 파일 재읽기 → 원격(MCP) 변경 반영

### Checkpoint B (옵션 2 end-to-end, Supabase 없이)
- [ ] 웹 편집·confirm → MCP `read_blueprint`가 즉시 같은 BP. MCP propose+confirm → 웹이 재읽기로 반영. rev 충돌 시 머지 다이얼로그.

### Phase C: 옵션 3 — 클라우드 공유 (수직)
- [ ] **TC1** MCP: `mcp-server.ts`를 `createStorage()`(backend-resolved)로 전환. env 있으면 supabase, 없으면 filesystem(무회귀). `@supabase/supabase-js` optionalDep + `supabase.sql` 스키마 확인/문서화
- [ ] **TC2** 웹 `CloudStore`: 기존 raw upsert를 rev-lock 쓰기(update where rev=baseRev)로 격상 + Realtime 구독(원격 confirm 반영). workspace_id 계약 SupabaseStorage와 정합
- [ ] **TC3** 웹·MCP 동일 workspace_id 공유 + 분기 처리

### Checkpoint C (옵션 3 end-to-end)
- [ ] 웹 편집 → Supabase → MCP(supabase backend)가 봄. MCP 변경 → 웹 Realtime 반영. rev-lock으로 동시쓰기 안전.

### Phase D: resolver 확정 + 혼란 방지 UX
- [ ] **TD1** 헤더 **저장 상태 배지**: 🟢클라우드(MCP·여러 기기) / 🔵로컬 파일(MCP 공유) / ⚪이 브라우저만 — 라벨+아이콘+tooltip
- [ ] **TD2** 배지 클릭 패널: 현재 모드 설명 + 업그레이드("폴더 연결"/"클라우드 연결") + 해제. 설정 "저장·백엔드" 탭과 일원화
- [ ] **TD3** **분기 다이얼로그**: 연결 시 대상 store BP ≠ 현재 BP면 선택/머지(침묵 덮어쓰기 금지, merge-modal 재사용)
- [ ] **TD4** 1회성 온보딩 줄 추가(ubp_onb_done): 3티어 3줄 설명
- [ ] **TD5** 티어 전환 migrate + confirm + 단일 진실원천 불변식(이중 쓰기 차단)

### Checkpoint D
- [ ] 새 사용자가 "내 데이터가 어디 있는지" 배지만 보고 안다. 연결/업그레이드/해제 흐름이 분기·확인을 거친다.

### Phase E: 문서
- [ ] **TE1** BLUEPRINT.md §7/§13에 3티어 store 모델 + 셋업 매트릭스. README에 옵션2/3 설정. MCP env(UBP_BACKEND/SUPABASE_*/UBP_WORKSPACE_ID) 표.

### Checkpoint E (Complete)
- [ ] 옵션2·옵션3 각 end-to-end 그린 + tier0 무회귀 + 문서 정합 + smoke 24/24 + build EXIT0.

---

## 상세 Task

### TA1 — store 계약 + resolver
**Files:** `web/whiteboard.html`(신규 어댑터 IIFE 블록), 영향: `saveBP/loadBP` 호출부.
**AC:** `StoreAdapter`(load/save/subscribe/info) 정의 · LocalStore가 기존 localStorage 동작 1:1 래핑 · `resolveStore()`가 (supabase설정?cloud:파일핸들?file:local) 판정 · `info()`가 배지용 {tier,label,shared} 반환.
**Verify:** agent-browser `ubp-debug` eval — resolveStore()가 각 설정 조합에서 기대 티어. 기존 편집·저장·새로고침 복원 무회귀.
**Dep:** none · **Scope:** M

### TB1 — 웹 FileStore (File System Access)
**Files:** `web/whiteboard.html`.
**AC:** `showDirectoryPicker`로 프로젝트/.blueprint 폴더 선택 → `getFileHandle('bp.json',{create:true})` · 핸들 IndexedDB 영속 → 재로드 후 `queryPermission`/`requestPermission` 재확보 · 미지원 브라우저(파이어폭스 등) 친절 안내 후 tier0 폴백.
**Verify:** (수동, 다이얼로그 자동화 불가) 폴더 연결 → bp.json 생성 확인 · 재로드 후 권한 재요청 1클릭 복구. 레시피 `tasks/browser-verify.md`.
**Dep:** TA1 · **Scope:** M

### TB2 — 파일 쓰기 디시플린(rev-lock·audit·snapshot)
**Files:** `web/whiteboard.html`.
**AC:** 저장 전 bp.json 재읽기→현재 rev 비교, baseRev 불일치면 중단(머지 트리거) · createWritable 임시쓰기+close(원자성) · `.blueprint/audit.jsonl`에 propose/confirm append · `.blueprint/snapshots/r#####-<sha>.json` 기록(50개 유지). `src/store.ts` 포맷과 동일.
**Verify:** 웹 confirm 후 audit.jsonl 라인 증가 + snapshots 파일 생성. 의도적 rev 조작 시 머지 다이얼로그.
**Dep:** TB1 · **Scope:** L

### TB3 — MCP 외부 파일 재읽기
**Files:** `src/store.ts`(get/propose/confirm 직전 가드), 가능시 `src/mcp-server.ts`.
**AC:** 파일 mtime 또는 디스크 rev > 메모리 rev면 재로드 후 진행 · 재로드와 진행중 propose의 baseRev 충돌은 기존 rev_mismatch로 안전 거부 · filesystem 외 backend엔 무영향.
**Verify:** `npm run test:mcp:e2e` 확장 — 외부에서 bp.json 교체 후 read_blueprint가 새 내용. smoke 24/24, build EXIT0.
**Dep:** none(B 묶음) · **Scope:** M

### TB4 — 웹 원격 변경 반영
**Files:** `web/whiteboard.html`.
**AC:** `visibilitychange`/`focus` + 저빈도 폴링으로 파일 rev 변화 감지 → 미저장 로컬 변경 없으면 자동 재로드, 있으면 "원격 N회 변경" 머지 안내(기존 토스트/머지 재사용) · 무한 저장 루프 방지.
**Verify:** MCP confirm → 웹 탭 포커스 시 rev-pill·캔버스 갱신.
**Dep:** TB2,TB3 · **Scope:** M

### TC1 — MCP backend 해석 전환
**Files:** `src/mcp-server.ts`, `package.json`(optionalDep), 문서.
**AC:** `BlueprintStore` 하드코딩 → `await createStorage(initial,{authz})` · env 없으면 filesystem(기존과 동일, 무회귀) · `UBP_BACKEND=supabase`+`SUPABASE_URL/KEY`+`UBP_WORKSPACE_ID`면 SupabaseStorage · 의존성 없을 때 친절 에러.
**Verify:** env 없는 `test:mcp:e2e` 19-tool 그린(무회귀) · (수동/mock) supabase backend bootstrap 성공.
**Dep:** none · **Scope:** M

### TC2 — 웹 CloudStore (rev-lock + Realtime)
**Files:** `web/whiteboard.html`.
**AC:** 기존 raw upsert → 조건부 update(`rev=baseRev`) 또는 RPC로 rev-lock · 실패 시 머지 · Realtime(또는 폴백 폴링) 구독해 원격 confirm 반영 · SupabaseStorage 행 계약(workspace_id,bp,rev) 정합.
**Verify:** 두 탭(또는 탭+MCP)에서 한쪽 confirm → 다른쪽 Realtime 반영, 동시 편집 시 한쪽 rev-lock 거부+머지.
**Dep:** TA1 · **Scope:** L

### TC3 — 웹·MCP 클라우드 공유 정합
**Files:** `web/whiteboard.html`, 문서.
**AC:** 웹 UI에서 workspace_id 설정·표시 · MCP `UBP_WORKSPACE_ID`와 동일하면 같은 행 공유 · 불일치 시 경고.
**Verify:** 동일 workspace에서 웹↔MCP 양방향 1회 라운드트립.
**Dep:** TC1,TC2 · **Scope:** S

### TD1–TD5 — 혼란 방지 UX
**Files:** `web/whiteboard.html`.
**AC:** 헤더 배지 3-상태 + tooltip(TD1) · 배지 패널 업그레이드/해제, 설정 탭 일원화(TD2) · 분기 다이얼로그 침묵덮어쓰기 금지(TD3) · 온보딩 3줄(TD4) · 티어 전환 migrate+confirm+이중쓰기 차단(TD5).
**Verify:** 각 티어에서 배지 정확 · 분기 시 다이얼로그 · 새 프로필 온보딩 노출. 스크린샷 3장(티어별).
**Dep:** TB*,TC* · **Scope:** L

### TE1 — 문서
**Files:** `BLUEPRINT.md`, `README.md`.
**AC:** 3티어 모델·결정 흐름·셋업 매트릭스 · MCP env 표 · 옵션2(폴더 연결)/옵션3(Supabase) 단계. 한국어 산문, 기존 톤 유지.
**Verify:** 링크·명령 정확, build/smoke 무관 그린.
**Dep:** A–D · **Scope:** M

## Risks & Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| 로컬 파일 동시 2-writer(웹+MCP) | High | rev-lock 모든 쓰기 + MCP mtime 재읽기 + 원자 swap + 머지 다이얼로그 |
| 웹 클라우드 raw upsert가 confirm 게이트 우회 | High | TC2에서 rev-lock update로 격상, last-writer-wins 제거 |
| File System Access Chrome/Edge 전용 | Med | 미지원 시 tier0 폴백 + 명시 안내. 다이얼로그는 수동 레시피 |
| 신규 사용자 "데이터 어디?" 혼란 | High(사용자 명시) | 배지 자가설명 + 온보딩 + 분기/ migrate 확인, 침묵 전환 금지 |
| 핸들 권한 만료(재로드) | Med | IndexedDB 핸들 + queryPermission 재확보 1클릭 |
| Supabase 키 포맷 함정(sb_publishable_*) | Med | legacy anon JWT 권장 안내(메모리: Supabase 키 함정) |

## 범위 밖 / 영원 배제
- 산출물 자체 렌더(pptx/PRD/이미지), touch/drawing — UBP 본질 외.
- 상시 HTTP 서버 강제(`src/server`는 선택적 멀티유저 경로로 유지, 이번 필수 아님).
- postgres/turso backend 신규 작업(존재만 유지).

## Open Questions (구현 착수 전 사용자 확인)
1. tier0(설정 없을 때 localStorage 기본) 유지가 맞나? — "html만 열면 됨" 보존 가정.
2. 옵션2 폴더 연결 대상: **프로젝트 루트**를 고르게 하고 그 안 `.blueprint/bp.json`을 찾거나 생성하는 방식이 맞나? (MCP `UBP_STORE`와 같은 파일을 가리켜야 공유됨)
3. 옵션3 웹 쓰기 인증: 브라우저는 anon 키(RLS 따름) 가정. service_role 키를 브라우저에 두는 건 금지(노출 위험). RLS 정책/스키마(supabase.sql) 적용을 사용자가 수행하는 전제가 맞나?
