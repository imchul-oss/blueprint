# Universal Blueprint Platform — Plan & Policy

이 문서는 UBP의 정책 파일이자, 통상 SaaS PRD 수준의 기획 문서를 겸한다.
정책 섹션(`Trackable Attributes`, `Required Slots`, `Blast Radius`, `Terminology Rules`)은
MCP 서버가 파싱해 모델에 주입한다(BLUEPRINT.md 변경 시 MCP가 재로드해야 함).

---

## 1. 문제 정의 (Problem)

LLM 기반 저작 도구는 산출물(PRD/PPT/코드/디자인)을 생성할 수 있으나, 의미적 산출물 간 **단일 진실원천**과 **양방향 정합성**이 없다. 결과적으로:

- 산출물 1에서 변경한 의도가 산출물 2~N에 전파되지 않음 → drift
- 모델이 누락 정보를 추측으로 채움 → 환각
- 자동 머지 → 사람 확인 없는 변경 → 사고

## 2. 솔루션 가설 (Solution)

블루프린트를 **포맷 중립 의도 그래프**로 정의하고, 산출물은 그래프의 렌더 출력으로 본다.
UBP는 렌더러를 만들지 않고 **MCP**로 모델에 위임한다. 변경은 항상 **propose → confirm** 게이트를 통과한다.

- 환각 통제: `Required Slots` 미충족 시 채우지 않고 `missing`으로 표면화 → clarify 질문
- Drift 방지: `traces-to` 앵커로 산출물-노드 추적성 유지
- 사고 방지: confirm gate + audit + snapshot + optimistic rev lock

## 3. Persona (Descriptive — 모드 셀렉터 아님)

UBP를 사용하는 사람들의 **기술(description)**이다. 페르소나별 UI 모드 분기는 두지 않는다.
페르소나에 맞춘 어조·깊이는 **모델 레이어(Claude/Gemini 등 소비 모델)** 가 입력 맥락을 보고 결정한다.

- **PM / 기획자**: 기능 정의·우선순위·의존성 관리
- **창업가 / 0→1**: 빠른 골격, 가설 → 실험 → 산출
- **바이브 코더**: 코드 변경이 곧 블루프린트 갱신 제안, 산출물 동기화
- **작가 / 사무원**: 정해진 슬롯을 채우는 형식 작성, 그래프 모델 무관심
- **연구자 / 전략**: claim·supports 그래프로 근거 추적

> "어떤 페르소나로 어떤 작업을 할지"는 입력 맥락에서 모델이 추론한다. 라우팅을 UI에 박지 않는다.

## 4. JTBD (Jobs-to-be-Done)

- *J1* "회의록을 PRD 초안으로 30분 → 5분 단축"
- *J2* "기능 우선순위 변경이 화면·데이터·QA 산출에 자동 반영되게"
- *J3* "AI가 누락 정보를 추측으로 채우지 않게"
- *J4* "팀원·에이전트의 변경 이력을 한 줄도 잃지 않게"
- *J5* "코드 작업 중 코드↔BP 양방향 동기화"

## 5. 경쟁 비교 (Competitive Landscape, Tier4)

| 도구 | 강점 | UBP 차별 |
|---|---|---|
| Notion AI / Coda | 자유도, 협업, 임베드 | 의미 그래프 부재. UBP는 anchor 기반 추적 |
| Linear / Jira | 워크플로우·티켓 | 산출물 렌더 부재. UBP는 모델에 위임 |
| Productboard / Aha! | 로드맵 중심 | confirm gate·blast radius 부재 |
| ChatPRD | LLM 자동 PRD 작성 | 단일 산출. 양방향 싱크·anchor 없음 |
| Figma Make | 디자인↔코드 | UI 도메인 한정 |

UBP는 "포맷 중립 + MCP 위임 + confirm gate + audit"의 조합이 차별점.

## 6. 성공 지표 (Metrics — 측정 정의 포함)

- *수동 보정율* `< 20%`
  - **정의**: confirm된 ops 중 사람이 후속 patch한 비율 (audit.jsonl로 자동 계산)
  - **기준선**: 미측정. 첫 100건으로 baseline 확정.
- *정합률* `>= 90%`
  - **정의**: 모델 산출 변경(`propose`) 중 anchor 매칭 성공 비율
  - **측정**: anchor가 존재하는 ops / 전체 ops
- *초안 도달 시간 단축*
  - **정의**: 빈 블루프린트 → P0 ≥ 5 + 필수 슬롯 충족까지의 분
  - **목표**: 평균 30분 미만 (baseline TBD)

`재사용 횟수는 성공 지표가 아니다`. UBP는 사고 구조화·방향 설정 도구이지 반복 사용을 강요하지 않는다.

## 7. NFR (Non-Functional Requirements)

- **보안**: MCP 토큰 인증, propose는 `actor` 필수. confirm은 사람 actor 권장(에이전트 자가승인 금지)
- **동시성**: meta.rev 낙관락. propose 시 baseRev 캡쳐 → confirm 시 mismatch면 거부
- **영속성**: WAL → swap 패턴. snapshots/<rev>-<sha>.json 50개 보관
- **감사**: audit.jsonl append-only (propose/confirm/reject/snapshot/restore)
- **접근성**: WCAG AA. `:focus-visible`, `prefers-reduced-motion`, `prefers-color-scheme` 존중
- **국제화**: 우선 한국어. 정책 키워드는 한/영 동시 인식 (parsePolicy)
- **성능**: 1000 노드까지 60fps 캔버스 목표. 그 이상은 가상화 트리거
- **백업/복구**: snapshot 기반 rollback(`restore_snapshot`)

## 8. 리스크 & 완화

| 리스크 | 완화 |
|---|---|
| LLM이 모순된 ops 제안 | confirm gate에서 사람 검수 + violation 표시 |
| 두 에이전트가 동일 anchor에 propose | rev mismatch 거부 → 재제안 유도 |
| BLUEPRINT.md 자기 갱신 무한 루프 | 정책 변경은 별도 confirm 채널 |
| 큰 BP에서 영향도 계산 비용 | depth=3 제한 + 캐시 |
| persist 실패 데이터 손실 | WAL → swap, audit으로 재구성 가능 |

## 9. Trackable Attributes

- `title`
- `status`
- `priority`
- `body`
- `attrs.acceptance_criteria`
- `attrs.fields`
- `attrs.definition`

## 10. Required Slots

- `feature`: [acceptance_criteria, priority]
- `data-entity`: [fields]
- `metric`: [definition]
- `claim`: [supports-edge>=1]
- `screen`: [screen-element>=1]

## 11. Blast Radius

- critical: 5
- warning: 2

## 12. Terminology Rules

- `화이트보드` -> `Whiteboard GUI`
- `블루프린트` -> `Universal Blueprint`
- `자동머지` -> `Confirm Gate`
- `리비전` -> `meta.rev`

## 13. Operations (개발·운영 가이드)

### 환경 셋업

| OS | 명령 |
|---|---|
| Windows | `npm i` (실패 시 `npm run repair`) |
| macOS | `npm i` |
| Linux | `npm i` |

`optionalDependencies` 에 OS별 esbuild·rollup 바이너리를 모두 명시했으므로 npm 7+ 환경이면 자동 설치된다. 일부 환경(컨테이너간 node_modules 복사 등) 에서 OS 미스매치가 발생하면 `npm run repair` 또는 `rm -rf node_modules package-lock.json && npm i`.

### 주요 스크립트

| 스크립트 | 효과 |
|---|---|
| `npm run build` | `tsc` — `src/` → `dist/` |
| `npm run mcp` | 컴파일된 MCP 서버 stdio 시작 |
| `npm run demo` | 컴파일된 데모 1회 실행 |
| `npm run smoke` | 환경 무관 스모크 검증 (15+ 케이스) |
| `npm test` | vitest 단위 테스트 (node_modules 정상 시) |
| `npm run repair` | esbuild·rollup 네이티브 바이너리 재설치 |

### 파일 레이아웃 (생성물)

```
.blueprint/
├── bp.json              # 단일 진실원천
├── bp.json.wal          # 영속화 임시 파일 (rename 직전)
├── audit.jsonl          # append-only 감사
└── snapshots/
    └── r00007-abc123def.json  # confirm 시점별 사본 (50개 보관)
BLUEPRINT.md             # 정책 + 기획서 + 운영 가이드
dist/                    # tsc 산출물 — 운영 시 이걸로 실행
smoke.mjs                # 환경 자가검증
```

### MCP 클라이언트 등록 예 (Claude Code)

```json
{
  "mcpServers": {
    "ubp": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "/path/to/ubp",
      "env": { "UBP_STORE": ".blueprint/bp.json", "UBP_POLICY": "BLUEPRINT.md" }
    }
  }
}
```

### 저장 3티어 모델 — tier0(이 브라우저) / 옵션2(로컬 파일) / 옵션3(클라우드)

웹·MCP 가 같은 blueprint 를 공유하는 방식은 **설정 존재로 자동 결정**된다. 활성 티어는 항상
헤더 배지로 보이며(⚪/🔵/🟢) 침묵 전환·침묵 덮어쓰기는 없다(rev-lock + 분기 다이얼로그).

| 티어 | 배지 | 저장 위치 | 웹↔MCP 공유 | 활성 조건 | 동시성 안전 |
|---|---|---|---|---|---|
| **tier0 (LOCAL)** | ⚪ 이 브라우저 | 브라우저 localStorage | ✗ (이 브라우저만) | 기본 폴백 | n/a (단일) |
| **옵션2 (FILE)** | 🔵 로컬 파일 | `.blueprint/bp.json` (+ `pos.json`) | ✓ 같은 PC | 폴더 연결(제스처) | rev-lock(파일 재읽기) |
| **옵션3 (CLOUD)** | 🟢 클라우드 | Supabase `blueprints` 행 | ✓ 여러 기기 | Supabase URL+anon key 설정 | rev-lock(조건부 PATCH) + Realtime |

우선순위(resolveStore): **Supabase 설정 → CLOUD ▸ 폴더 핸들 → FILE ▸ 그 외 → LOCAL.**
- 옵션2: 웹은 File System Access 로 프로젝트 루트를 연결, MCP 는 `UBP_STORE` 를 그 `.blueprint/bp.json`
  으로 맞춘다. `bp.json` 은 MCP 와 동일 Blueprint(좌표 제외) — 좌표는 사이드카 `pos.json`.
- 옵션3: 웹은 anon 키로 PostgREST upsert/PATCH(RLS), MCP 는 `UBP_BACKEND=supabase`. `bp` 컬럼은
  MCP 와 동일 Blueprint, 좌표는 웹 전용 `pos` 컬럼(MCP 무시). 스키마는 `src/server/storage/supabase.sql`.

#### 셋업 매트릭스

| 하고 싶은 것 | 웹 설정 | MCP env | 사전 작업 |
|---|---|---|---|
| 이 브라우저에서만 | (없음) | `UBP_STORE` | 없음 |
| 같은 PC 의 MCP 와 공유 | 배지 → "폴더 연결" | `UBP_STORE`=연결 폴더 `.blueprint/bp.json` | 없음 |
| 여러 기기·클라우드 공유 | 저장·백엔드 탭 → Supabase URL/anon key + 워크스페이스 ID | `UBP_BACKEND=supabase` + `SUPABASE_URL`/`SUPABASE_ANON_KEY`(또는 service) + `UBP_WORKSPACE_ID`(웹과 동일) | `supabase.sql` 적용 |

### MCP 환경 변수 표

| 변수 | 기본값 | 효과 |
|---|---|---|
| `UBP_STORE` | `.blueprint/bp.json` | filesystem 백엔드 BP 경로 (옵션2 공유 키) |
| `UBP_POLICY` | `BLUEPRINT.md` | 정책 문서 경로 (핫리로드) |
| `UBP_BACKEND` | `filesystem` | 저장 백엔드 — `filesystem`\|`supabase`\|`postgres`\|`turso` |
| `UBP_WORKSPACE_ID` | `default` | 옵션3 워크스페이스 격리 키 — **웹 워크스페이스 ID 와 동일해야 공유됨** |
| `SUPABASE_URL` | — | `UBP_BACKEND=supabase` 시 필수 |
| `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | — | Supabase 인증 키 (RLS 적용 시 anon, 서버 신뢰 시 service) |
| `UBP_FORBID_SELF_CONFIRM` | — | `1` 이면 propose 한 actor 의 자가 confirm 거부 (NFR: 에이전트 자가승인 금지 강제) |

`UBP_BACKEND` 미설정 시 filesystem 으로 동작하므로 기존 옵션2/단일 사용자 셋업은 무회귀.

### 자가 점검 체크리스트

- [ ] `npm run build` 그린
- [ ] `npm run smoke` 모두 통과
- [ ] `.blueprint/audit.jsonl` 생성 확인
- [ ] `.blueprint/snapshots/` 디렉토리 존재
- [ ] `BLUEPRINT.md` 변경 후 `get_policy` MCP 호출 → 변경 반영 확인 (핫리로드)

---

## 14. Glossary

- **Anchor**: 산출물 요소가 BP의 어디에 대응되는지. `#nodeId` 또는 `#nodeId.attrs.<키>`
- **Confirm Gate**: 변경의 자동 머지를 금지하고 사람 actor 승인을 강제하는 게이트
- **Blast Radius**: 한 노드 변경이 엣지를 따라 파급되는 노드 집합 (depth=3)
- **Rev**: `meta.rev` 정수. 낙관 동시성의 키.
- **Snapshot**: confirm 시점 BP 전체의 영속 사본. 롤백 단위.
- **Audit**: 모든 propose/confirm/reject/snapshot/restore의 append-only 로그.
