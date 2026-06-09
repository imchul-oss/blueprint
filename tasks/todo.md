# TODO: MCP-로컬 검증·하드닝 패스  — ✅ Phase 0~2 완료 (2026-06-10)

MCP-로컬 사용 = 가능 (stdio + 파일시스템 store, 네트워크 0). Supabase/REST는 범위 밖.
베이스라인(완료): build ✅ · smoke ✅24/24 · mcp-logic ✅7/7(npm 연결) · **e2e ✅19-tool** · vitest ❌(smoke 대체)

## Phase 0 — 하네스
- [x] **T0** MCP 테스트 npm 연결 + 베이스라인 (S)
  - [x] `test:mcp`(logic), `test:mcp:e2e`(build→spawn) 스크립트 추가
  - [x] `npm run test:mcp` 7/7, smoke 24/24, build EXIT0
  - [x] README 로컬 MCP 실행·검증 1줄
- [x] ✅ **Checkpoint: Foundation**

## Phase 1 — MCP 도구 표면 (node)
- [x] **T1** e2e false-green confirm 수정 + 로컬 증명 (S) · dep:T0
  - [x] proposalId regex `(p_\d+)`→`p_\w+`
  - [x] confirm 후 n_demo 반영 hard-assert(미반영 exit1)
  - [x] 임시 UBP_STORE로 .blueprint 비오염
- [x] **T2** 도구 표면 커버리지 확장 (M) · dep:T1
  - [x] get_policy/get_missing/list_pending/reject_update/tail_audit
  - [x] list_snapshots+restore_snapshot 라운드트립
  - [x] scan_code_anchors/list_conflicts/compliance_stats/propose_from_prompt/get_harness
  - [x] 실패 시 exit1
- [x] ✅ **Checkpoint: MCP**

## Phase 2 — GUI 회귀 (browser, `ubp-debug`)
- [x] **T3** JSON Canvas 라운드트립 + properties (S) · dep:T0
- [x] **T4** 첨부 4모드 ref·다운그레이드 (M) · dep:T3
- [x] **T5** anchor 파싱 + UI 폴리시 회귀 (M) · dep:T4
- [x] ✅ **Checkpoint: Complete**

## 범위 밖
- Supabase/postgres/turso 어댑터 + REST 서버 = SaaS 경로 (추후 별도 패스)

## 자동화 불가(수동 레시피, 통과 위장 금지)
- showDirectoryPicker / showSaveFilePicker / 실 Supabase 네트워크
