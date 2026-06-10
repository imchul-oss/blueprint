# TODO: 설정 기반 단일 store 통합 (옵션 2 + 옵션 3, 자동 강등)

해석: Supabase 설정→옵션3(클라우드), 폴더 연결만→옵션2(로컬 파일), 둘 다 없음→tier0(이 브라우저).
1급 요구: 활성 store를 항상 눈에 보이게 + 자가설명. 침묵 전환·덮어쓰기 금지.
상태: 📋 계획 작성, 구현 미착수 (사용자 승인 대기).

## Phase A — 계약·resolver
- [x] **TA1** StoreAdapter 인터페이스 + LocalStore/FileStore/CloudStore stub + resolveStore() + info() 배지모델 (M)
- [x] ⛳ **Checkpoint A** 기존 동작 무회귀, resolveStore 3티어 정확 판정

## Phase B — 옵션 2 (로컬 파일 공유, Supabase 불필요)
- [x] **TB1** 웹 FileStore: FS Access로 .blueprint/bp.json + 핸들 IndexedDB 영속 + 권한 재확보 (M) · dep:TA1
- [x] **TB2** rev-lock 저장 + audit.jsonl + snapshots/ + 원자 swap (L) · dep:TB1
- [x] **TB3** MCP BlueprintStore 외부 파일 재읽기(mtime/rev 가드) (M) · dep:none
- [x] **TB4** 웹 focus/visibility+폴링 재읽기 → MCP 변경 반영 (M) · dep:TB2,TB3
- [x] ⛳ **Checkpoint B** 웹↔MCP 같은 bp.json 양방향, rev 충돌 머지 — mock-FS 자동검증 + MCP node e2e 통과, 다이얼로그 경로는 browser-verify.md TB 수동 레시피
  - 잔여(수동): 실제 showDirectoryPicker/requestPicker 제스처 경로 — 자동화 불가

## Phase C — 옵션 3 (클라우드 공유)
- [x] **TC1** MCP createStorage() 전환(env 없으면 filesystem 무회귀) + supabase pos 컬럼/스키마 (M) · dep:none
- [x] **TC2** 웹 CloudStore: raw upsert→rev-lock 조건부 PATCH + Realtime 구독+폴링 폴백, 레거시 미러 제거 (L) · dep:TA1
- [x] **TC3** 웹·MCP 동일 workspace_id 공유 정합(UI.workspaceId ↔ UBP_WORKSPACE_ID) (S) · dep:TC1,TC2
- [x] ⛳ **Checkpoint C** 웹↔MCP(supabase) 양방향, 동시쓰기 rev-lock 안전 — mock-Supabase fetch 검증: insert/load 라운드트립·rev-lock 충돌 발화·force-mine·pull, CLOUD 배지/패널/분기 다이얼로그 통과. build EXIT0 + smoke 24/24. 스크린샷 tasks/tc-cloud-badge.png
  - 잔여(수동): 실 Supabase 네트워크/RLS/Realtime websocket → tasks/browser-verify.md TC

## Phase D — 혼란 방지 UX
- [x] **TD1** 헤더 저장 상태 배지 3-상태(🟢클라우드/🔵로컬파일/⚪이 브라우저) +tooltip (M)
- [x] **TD2** 배지 패널 업그레이드/해제 + 설정 "저장·백엔드" 탭 진입 버튼 (M)
- [x] **TD3** 분기 다이얼로그(디스크로드/강제덮어/취소, 침묵덮어쓰기 금지) (M)
- [x] **TD4** 1회성 온보딩 1줄(3티어 배지 설명) (S)
- [x] **TD5** 폴더 해제 migrate(파일유지) + 단일진실원천 이중쓰기 차단(LOCAL만 클라우드 미러) (M)
- [x] ⛳ **Checkpoint D** 배지만 보고 데이터 위치 파악, 연결/해제/충돌 분기·확인 — 자동검증: 배지 3-상태·needs-attn·패널·분기 다이얼로그 통과, 스크린샷 tasks/td-store-badge.png

## Phase E — 문서
- [x] **TE1** BLUEPRINT.md 3티어 모델·셋업 매트릭스 + MCP env 표 + README 옵션2/3 공유 섹션·env 표 확장 (M) · dep:A–D
- [x] ⛳ **Checkpoint E (Complete)** 옵션2·3 end-to-end + tier0 무회귀 — build EXIT0 + smoke 24/24, mock-FS(TB)·mock-Supabase(TC) 검증, MCP createStorage filesystem 무회귀

## 자동화 불가(수동 레시피, 통과 위장 금지)
- showDirectoryPicker / requestPermission / 실 Supabase 네트워크 → tasks/browser-verify.md

## 착수 전 확인 (plan.md Open Questions)
1. tier0 localStorage 기본 유지?
2. 옵션2 = 프로젝트 루트 선택 → 그 안 .blueprint/bp.json(=MCP UBP_STORE) 공유?
3. 옵션3 = 브라우저 anon 키(RLS), service_role 금지, supabase.sql 사용자 적용 전제?
