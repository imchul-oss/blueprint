<div align="center">

# UBP — Universal Blueprint Platform

**Blueprint-first authoring.** Design the *skeleton* of your deliverable as a visual semantic graph, then serve it to an LLM over MCP so the model produces the artifact — with hallucination kept on a leash.

블루프린트 우선 저작 도구. 산출물을 *직접* 만들지 않고, 산출물의 **뼈대(의도 그래프)** 를 시각으로 짜서 MCP로 LLM에 서빙 → 모델이 산출물을 생성한다. 환각은 4축으로 통제.

`MCP-native` · `local-first` · `zero-network single-user` · `optional SaaS REST`

</div>

---

> **English first, 한국어 below each section.** Read whichever you prefer — both halves carry the same facts.

## Table of Contents

- [What is UBP?](#what-is-ubp--ubp란)
- [The five forever-pillars](#the-five-forever-pillars--본질-5축)
- [Hallucination control](#hallucination-control--환각-통제-4축)
- [Quick start](#quick-start--빠른-시작)
- [MCP server setup](#mcp-server-setup--mcp-서버-설정)
- [MCP tool reference (22 tools)](#mcp-tool-reference--mcp-도구-레퍼런스-22개)
- [Storage backends](#storage-backends--저장-백엔드)
- [Attachment storage modes](#attachment-storage-modes--첨부-저장-모드)
- [SaaS REST + SSE server](#saas-rest--sse-server--saas-서버)
- [AI / LLM connection](#ai--llm-connection--ai--llm-연결)
- [Keyboard shortcuts](#keyboard-shortcuts--단축키)
- [Testing & verification](#testing--verification--테스트검증)
- [Directory structure](#directory-structure--디렉토리-구조)
- [License](#license--contributing--라이선스--기여)

---

## What is UBP? · UBP란

UBP is **not** a tool that renders the final deliverable (no `.pptx` slides, no rendered PRD pages, no generated source files). It is a **wireframe platform for intent**: you lay out a node-and-edge semantic graph — the *skeleton* of a PRD, deck, article, or codebase — and UBP serves that skeleton to an LLM as structured context. The LLM does the rendering; UBP guards the structure.

The graph lives in a single-file whiteboard UI (`web/whiteboard.html`, no build step) and is exposed to LLM clients (Claude Desktop, Claude Code, Cursor) through an **MCP stdio server**. Every LLM-proposed change passes through a **Confirm Gate** before it touches the blueprint.

UBP는 산출물을 *렌더하는* 도구가 **아니다** (.pptx 슬라이드 / PRD 페이지 / 코드 파일 생성 안 함). 산출물의 **뼈대**(PRD·덱·글·코드의 의도 그래프)를 노드-엣지로 짜서 LLM에 구조화 컨텍스트로 서빙하는 **의도 와이어프레임 플랫폼**이다. 렌더는 LLM이, 구조 보존은 UBP가 맡는다. 그래프는 단일 파일 화이트보드 UI(`web/whiteboard.html`, 빌드 불필요)에 살고, **MCP stdio 서버**로 LLM 클라이언트(Claude Desktop/Code, Cursor)에 노출된다. LLM이 제안한 모든 변경은 블루프린트에 반영되기 전 **Confirm Gate**를 통과한다.

---

## The five forever-pillars · 본질 5축

| # | Pillar | 본질 |
|---|--------|------|
| 1 | **Card + wire semantic graph** — 15 NodeRoles + 7 EdgeTypes + free labels | 카드 + 와이어 의미 그래프 |
| 2 | **Hallucination control** — required slots · Confirm Gate · Snapshot · Audit log | 환각 통제 4축 |
| 3 | **Storage adapters** — FileSystem · Supabase · Postgres · Turso (one interface, four backends) | 저장 어댑터 4종 |
| 4 | **MCP serving** — 22 stdio tools (`get_harness`, `propose_update`, `confirm_update`, `read_attachments`, `check_anchor_drift`, …) | MCP 서빙 22 도구 |
| 5 | **Reference attachments** — image · sketch · link · file ("make it in *this* shape") | 레퍼런스 첨부 |

**Forever-excluded** (out of scope by design): rendering the deliverable itself (`.pptx`, PRD pages, source files), touch/mobile UI, and autonomous unattended loops.

**영원 배제**: 산출물 자체 렌더(.pptx/PRD/코드), 터치·모바일 UI, 자동 무인 반복 운행.

### NodeRoles (15) · EdgeTypes (7)

```
Roles:  product · goal · persona · metric · requirement · feature · flow ·
        flow-step · screen · screen-element · component · data-entity ·
        section · claim · note
Edges:  parent · depends-on · supports · realizes · flows-to ·
        renders-on · traces-to
```

---

## Hallucination control · 환각 통제 4축

This is the heart of UBP. An LLM is powerful but confident-when-wrong; UBP constrains it on four axes:

UBP의 핵심. LLM은 강력하지만 *틀려도 확신*하므로 4축으로 통제한다:

1. **Required slots · 필수 슬롯** — each role declares required attributes. A `feature` without `acceptance_criteria` and `priority` is surfaced as *missing* (see `get_missing`). 역할별 필수 속성. 예: `feature`는 `acceptance_criteria`·`priority` 없으면 결여로 표면화.
2. **Confirm Gate · 컨펌 게이트** — every change is a `propose` first; nothing touches the blueprint until an explicit `confirm`. Optimistic locking via `baseRev`. In the whiteboard: ghost **dry-run preview** before approving, node-level **cherry-pick merge** on store divergence, and a **clarify loop** that turns missing-slot answers into gated proposals (never auto-filled). 모든 변경은 우선 `propose`; 명시 `confirm` 전엔 BP 미반영. `baseRev` 낙관락. 웹에서는 승인 전 고스트 미리보기·분기 시 노드 단위 선택 머지·빈 슬롯 답변→제안 생성(clarify) 지원.
3. **Snapshot · 스냅샷** — every confirm writes a restorable snapshot (sha-addressed); roll back any time. confirm마다 복구 가능한 스냅샷(sha) 생성.
4. **Audit log · 감사 로그** — append-only `audit.jsonl` records who/when/what for propose/confirm/reject/snapshot/restore. append-only 감사 로그로 누가·언제·무엇을 추적.

Self-check tools (`compliance_stats`, `verify_bp_context`, `compliance_summary_for_llm`) let the model measure its own match-rate. **UBP never calls an LLM itself** — it bundles context for *the calling model* to reason over.

자가점검 도구로 모델이 자기 정합률을 측정한다. **UBP는 LLM을 직접 호출하지 않는다** — 컨텍스트를 묶어 *호출 모델*에게 넘길 뿐.

---

## Quick start · 빠른 시작

### Option A — Whiteboard only (no install, no server) · 화이트보드만 (설치·서버 불필요)

Open the single-file UI directly in a browser. Blueprint persists in `localStorage`.

```
file:///<path-to-repo>/web/whiteboard.html
```

브라우저로 위 파일을 직접 연다. BP는 `localStorage`에 저장. **설치·서버 없이 즉시 작동.**

### Option B — MCP server (expose to Claude Desktop / Code / Cursor) · MCP 서버

```bash
npm install
npm run build      # tsc → dist/ (produces dist/mcp-server.js)
npm run mcp        # MCP stdio server
```

> ⚠️ MCP uses `npm run build` (full `tsconfig.json`). `npm run build:server` is a *different* build that compiles only the SaaS REST server (`src/server`, `src/core`) and does **not** produce `dist/mcp-server.js`.
>
> MCP는 `npm run build`를 쓴다. `build:server`는 SaaS 서버 전용 빌드라 `dist/mcp-server.js`를 만들지 않는다.

### Sharing the same blueprint between web & MCP — 3 tiers · 웹↔MCP 공유 3티어

The active tier is **auto-decided by configuration** and always shown in the header badge (no silent switch, no silent overwrite — rev-lock + divergence dialog). 활성 티어는 설정으로 자동 결정되고 헤더 배지로 항상 표시된다.

| Tier · 티어 | Badge | Where · 위치 | Web↔MCP share | Activate · 활성 |
|---|---|---|---|---|
| **tier0 (LOCAL)** | ⚪ | browser `localStorage` | ✗ this browser only | default · 기본 |
| **옵션2 (FILE)** | 🔵 | `.blueprint/bp.json` (+ `pos.json`) | ✓ same PC | badge → "폴더 연결" (gesture); set MCP `UBP_STORE` to that file |
| **옵션3 (CLOUD)** | 🟢 | Supabase `blueprints` row | ✓ multi-device | `⌘.` → Storage: Supabase URL/anon key + workspace ID; set MCP `UBP_BACKEND=supabase` + `UBP_WORKSPACE_ID` |

Priority · 우선순위: Supabase config → CLOUD ▸ folder handle → FILE ▸ else → LOCAL. `bp.json`/`bp` column stays MCP-compatible (Blueprint only); node positions live in a web-only sidecar (`pos.json` / `pos` column). For cloud, apply `src/server/storage/supabase.sql` (includes the `blueprints.pos jsonb` column) and **match the web workspace ID to MCP `UBP_WORKSPACE_ID`**.

---

## MCP server setup · MCP 서버 설정

Register UBP in your MCP client config. The server is pure stdio + a filesystem store (`.blueprint/bp.json`) — **zero network, zero database**.

MCP 클라이언트 설정에 등록. 서버는 stdio + 파일시스템 스토어(`.blueprint/bp.json`)만 쓰며 **네트워크·DB 0**.

**Claude Desktop** (`claude_desktop_config.json`) **or Claude Code** (project-root `.mcp.json`, or `claude mcp add`):

```json
{
  "mcpServers": {
    "ubp": {
      "command": "node",
      "args": ["<ABSOLUTE-PATH-TO-REPO>/dist/mcp-server.js"],
      "env": {
        "UBP_STORE": "<ABSOLUTE-PATH-TO-REPO>/.blueprint/bp.json"
      }
    }
  }
}
```

> Replace `<ABSOLUTE-PATH-TO-REPO>` with the **absolute** path to your cloned repo — relative paths do not work (the client launches the server from its own cwd). Windows: use forward slashes, e.g. `C:/Users/you/ubp/dist/mcp-server.js`. macOS/Linux: e.g. `/Users/you/ubp/dist/mcp-server.js`.
>
> `<ABSOLUTE-PATH-TO-REPO>`를 클론한 레포의 **절대경로**로 바꾼다 — 상대경로는 안 된다(클라이언트가 자기 cwd에서 서버를 실행). Windows는 슬래시(`/`) 사용.

| Env var | Default | Purpose |
|---|---|---|
| `UBP_STORE` | `.blueprint/bp.json` | Path to the live blueprint JSON store (filesystem backend, 옵션2 share key) · 라이브 BP 저장 경로 |
| `UBP_POLICY` | `BLUEPRINT.md` | Policy file (hot-reloaded) · 정책 파일(핫리로드) |
| `UBP_BACKEND` | `filesystem` | Storage backend — `filesystem`\|`supabase`\|`postgres`\|`turso`. Unset → filesystem (no regression) · 미설정 시 filesystem |
| `UBP_WORKSPACE_ID` | `default` | 옵션3 workspace isolation key — **must equal the web workspace ID to share** · 웹 워크스페이스 ID 와 동일해야 공유 |
| `SUPABASE_URL` / `SUPABASE_KEY` | — | Required when `UBP_BACKEND=supabase` · supabase 백엔드 시 필수 |
| `UBP_FORBID_SELF_CONFIRM` | — | `1` rejects confirm by the same actor who proposed (no agent self-approval) · 에이전트 자가승인 차단 |

After registering, **restart the client**; the 22 tools below appear automatically. Verify with `claude mcp list` (Claude Code) or the 🔌 tool indicator (Desktop).
등록 후 **클라이언트 재시작**하면 아래 22개 도구가 자동 노출. `claude mcp list`로 확인.

### Using UBP from a connected LLM — the loop · 연결 후 사용 흐름

Once the server is registered, you don't call tools by hand — you talk to the LLM, and it drives the tools. The intended loop:

서버가 등록되면 도구를 직접 호출하지 않는다 — LLM에게 말하면 LLM이 도구를 굴린다. 의도된 루프:

1. **Design the skeleton** in `web/whiteboard.html` (nodes = intent, edges = relations). Or start empty. 화이트보드에서 뼈대를 짠다(또는 빈 상태로 시작).
2. **Tell the LLM to load context:** *"Read the UBP blueprint and tell me what's missing."* → the model calls `get_harness` (policy + BP + missing slots + pending) then `get_missing`. LLM에게 "UBP 블루프린트 읽고 뭐가 비었는지 알려줘" → `get_harness`·`get_missing` 호출.
3. **Ask for a change in natural language:** *"Add a login feature with P0 priority under the auth product."* → the model calls `propose_update` (or `propose_from_prompt`). **Nothing is applied yet** — it returns a `proposalId` + impact. 자연어로 변경 요청 → `propose_update` → 아직 미반영, `proposalId`만 회신.
4. **Review & confirm:** check the proposal (`list_pending` / `critic_pending_context`), then *"confirm it"* → `confirm_update`. This is the **Confirm Gate** — the only step that mutates the blueprint, and it writes a snapshot. 검토 후 "확정해줘" → `confirm_update`(컨펌 게이트, 스냅샷 생성).
5. **Render the deliverable:** *"Now write the PRD from this blueprint."* → the model calls `read_blueprint` and renders the artifact **in the chat / its own files** — UBP itself never renders. "이 블루프린트로 PRD 써줘" → `read_blueprint` 후 모델이 산출물 렌더(UBP는 렌더 안 함).
6. **Roll back if needed:** `list_snapshots` → `restore_snapshot` by `sha`. 필요시 스냅샷 복구.

**Recommended first call:** `get_harness` — one shot bundles the policy, current blueprint (`llms.txt` form), hallucination self-check, missing slots, and pending proposals. 작업 시작 시 `get_harness` 호출 권장.

---

## MCP tool reference · MCP 도구 레퍼런스 (22개)

### Read & inspect · 읽기·점검
| Tool | What it does |
|------|--------------|
| `read_blueprint` | Returns the blueprint as JSON + natural-language summary + anchors. Render PRD/PPT/code from this. Options: `nodeIds` (scoped read, +1-hop neighbors), `sinceRev` (delta — only nodes changed since that rev), `target` (`prd\|deck\|code\|policy` serving profile with target-specific render guide). |
| `read_attachments` | Node reference attachments (image/sketch/link/file) served to the model — inline images returned as real image blocks. 노드 첨부를 모델에 전달(이미지는 이미지 블록). |
| `get_policy` | Current `ProjectPolicy` (JSON). Hot-reloads when `BLUEPRINT.md` changes. |
| `get_missing` | Nodes with empty required slots + clarifying questions. |
| `get_harness` | One-shot work-start bundle: policy + current BP + hallucination self-check + missing slots + pending proposals. |
| `list_pending` | Pending proposals awaiting confirm/reject. |
| `list_conflicts` | Pairs of pending proposals that mutate the same anchor (node or attr path). |
| `list_snapshots` | Snapshot list (rollback points). |
| `tail_audit` | Last N audit entries (propose/confirm/reject/snapshot/restore). |

### Change (Confirm Gate) · 변경 (컨펌 게이트)
| Tool | What it does |
|------|--------------|
| `propose_update` | Propose a change (NOT applied immediately). `ops`=JSON array string, `intent`, `actor`, `baseRev` (optimistic lock). |
| `confirm_update` | Apply a proposed change after human approval. Needs `proposalId`. With `UBP_FORBID_SELF_CONFIRM=1`, the proposing actor cannot confirm its own proposal (no agent self-approval). |
| `reject_update` | Reject a proposal. Needs `proposalId`, `reason` recommended. |
| `propose_from_prompt` | Convert a natural-language prompt into a proposal via local orchestrator (no LLM call). Low-confidence input is *gracefully rejected by design*. |
| `restore_snapshot` | Restore the BP from a snapshot `sha` (advances rev, preserves history). |

### Code ↔ blueprint traceability · 코드↔BP 추적성
| Tool | What it does |
|------|--------------|
| `scan_code_anchors` | Scan code/markdown for `@ubp-anchor: #nodeId[.path]` markers. |
| `anchor_to_propose` | Turn scanned anchors into `traces-to` edge proposals. |
| `check_anchor_drift` | Drift report: anchors pointing at nodes that no longer exist + confirmed feature/component nodes with **no** code anchor. drift 능동 감시. |

### LLM self-check bundles (UBP never calls an LLM) · 자가점검 번들
| Tool | What it does |
|------|--------------|
| `critic_pending_context` | Bundle pending proposals for an external AI to review (the *caller* finds violations/improvements). |
| `refine_missing_context` | Bundle missing-slot nodes + fill context for the caller to propose values. |
| `verify_bp_context` | Bundle the whole BP for the caller to analyze gaps/consistency/weaknesses. |
| `compliance_stats` | Match-rate & manual-correction-rate statistics from `audit.jsonl`. |
| `compliance_summary_for_llm` | Compact match-rate summary so a model can self-check against the 4 hallucination axes. |

> **Note on `propose_from_prompt`:** rejecting an ambiguous prompt with low confidence is **intended behavior**, not a bug. UBP's philosophy is to refuse-when-uncertain rather than guess ops. 모호한 프롬프트의 저신뢰 거절은 **의도된 동작**(버그 아님). 추측보다 거절이 환각통제 철학에 부합.

---

## Storage backends · 저장 백엔드

One `BlueprintStorage` interface, four implementations. The **MCP path uses only the filesystem store**; the others power the optional SaaS REST server.

`BlueprintStorage` 인터페이스 하나에 구현 4종. **MCP 경로는 파일시스템 스토어만** 사용하고, 나머지는 선택적 SaaS 서버용이다.

| Backend | `UBP_BACKEND` | Required env | Use case |
|---------|---------------|--------------|----------|
| **FileSystem** | `filesystem` (default) | — | Local single-user, MCP |
| **Supabase** | `supabase` | `SUPABASE_URL`, `SUPABASE_KEY` (service_role) | Multi-user cloud, RLS |
| **Postgres** | `postgres` | `DATABASE_URL` | Self-hosted multi-user |
| **Turso** | `turso` | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Edge SQLite |

### Supabase setup (cloud multi-user) · Supabase 세팅

1. Create a project at [supabase.com]. 프로젝트 생성.
2. SQL Editor → run the full contents of `src/server/storage/supabase.sql`. This creates 7 tables (`workspaces`, `memberships`, `blueprints`, `pending_proposals`, `audit_entries`, `snapshots`, `attachments`), full **RLS policies** (viewer=propose / editor=confirm+restore / owner=admin), an atomic `confirm_proposal()` `SECURITY DEFINER` function, indexes, and append-only audit protection.
3. Storage → new bucket `ubp-attachments` (public, or private + signed URLs).
4. Server env: `UBP_BACKEND=supabase`, `SUPABASE_URL=…`, `SUPABASE_KEY=…` (service_role, server-only), then `npm run build:server && npm run server`.
5. Client (`⌘.` → Storage): Supabase URL, **anon** key (not service_role), bucket `ubp-attachments`, attachment mode = Supabase Storage.

> **Key format trap:** the new `sb_publishable_*` keys are incompatible with the existing RLS setup — use the **legacy anon JWT** (`eyJhbGc…`). 신 포맷 `sb_publishable_*` 키는 RLS와 비호환 — legacy anon JWT 사용.

### Postgres / Turso

```bash
# Postgres
export UBP_BACKEND=postgres
export DATABASE_URL=postgres://user:pass@host:5432/ubp
npm i postgres

# Turso (edge SQLite) — schema ~= Postgres, jsonb → text (JSON.stringify)
export UBP_BACKEND=turso
export TURSO_DATABASE_URL=libsql://your-db.turso.io
export TURSO_AUTH_TOKEN=...
npm i @libsql/client
```

---

## Attachment storage modes · 첨부 저장 모드

| Mode | Bound to BP? | Portability | Collab | Best for |
|------|--------------|-------------|--------|----------|
| **Inline** | ✓ base64 embedded | move 1 BP file | share via export | small images (~256KB), max portability |
| **IndexedDB** | ✗ browser DB | this PC + browser only | ✗ | single PC, keep BP light |
| **Local FS** | ✗ real files in folder | move folder + BP | zip the folder | Chrome/Edge, folder collab (`showDirectoryPicker`) |
| **Supabase Storage** | ✗ public URL in BP | URL travels in BP | ✓ multi-user | cloud collab |
| **URL only** | ✗ external URL | URL in BP | ✓ anyone | already hosted (S3, GitHub raw, …) |

Auto-downgrade: a >10 MB file in `inline` mode falls back to a non-inline store. Set the default at `⌘.` → Storage → "default attachment mode".
10MB 초과 파일은 inline에서 자동 다운그레이드. 기본값은 `⌘.` → 저장 설정에서.

---

## SaaS REST + SSE server · SaaS 서버

Optional multi-user path (auth, workspaces, members, SSE live updates). **Not required for local MCP usage.**

선택적 멀티유저 경로(인증·워크스페이스·멤버·SSE 실시간). **로컬 MCP 사용엔 불필요.**

```bash
npm run build:server
npm run server          # default :4173  (override with PORT)
```

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `4173` | HTTP listen port |
| `DATA_DIR` | `./.ubp-data` | Filesystem-backend data dir |
| `UBP_BACKEND` | `filesystem` | Storage adapter selector |

Endpoints: `register`/`login` (JWT), `/workspaces`, `/members`, `/blueprint`, `/missing`, `/proposals` (POST/GET/confirm/reject), `/conflicts`, `/audit`, `/snapshots/:sha/restore`, `/compliance`, `/ai-propose`, `/events` (SSE), `/health`.

---

## AI / LLM connection · AI · LLM 연결

`⌘.` → General settings → **AI · LLM connection**:

- **Provider**: Anthropic Claude API / OpenAI / OpenRouter / Custom OpenAI-compatible
- **Model ID**: `claude-opus-4-7`, `claude-sonnet-4-6`, `gpt-4o`, …
- **API key**: stored in `localStorage` (beware shared PCs · 공유 PC 주의)
- **Test connection** button for instant validation

Left-side AI panel takes natural-language commands:
- Pattern match (e.g. `add feature: social login, priority P0`) → orchestrator proposes immediately.
- No match + LLM configured → LLM generates ops JSON → proposal queue → **Confirm Gate**.

**Essence guard:** LLM output is only ever folded into node bodies / the proposal queue. UBP never renders the deliverable itself. LLM 응답은 노드 body·propose 큐로만 통합되며, 산출물 자체는 렌더하지 않는다.

---

## Keyboard shortcuts · 단축키

| Key | Action |
|---|---|
| `⌘K` | Command palette · 명령 팔레트 |
| `⌘F` | Search nodes/edges · 검색 |
| `⌘,` | UI / design settings · UI·디자인 설정 |
| `⌘.` | General settings (storage · AI · canvas) · 일반 설정 |
| `⌘⇧L` | Light ↔ dark toggle · 라이트/다크 |
| `⌘O` | Outline panel · 아웃라인 |
| `⌘Z` / `⌘Y` | undo / redo |
| `⌘Enter` / `⌘⌫` | Approve / reject the first pending proposal · 첫 보류 제안 승인/거절 |
| `⌘G` | Group selected nodes into a frame (≥2 selected) · 선택 노드 그룹화 |
| `Delete` | Delete selected node/edge (confirm gate) · 삭제 |
| `Alt + drag` | Duplicate node · 노드 복제 |
| `Shift + drag (empty canvas)` | Lasso multi-select · 라소 선택 |
| `Space + drag` | Pan canvas · 캔버스 pan |
| Right-click node | Context menu (delete · duplicate · center · inspector · new node) · 우클릭 메뉴 |
| Right-click multi-selection | Group into frame · 그룹으로 묶기 |
| Node 4-way `+` | ↑ parent / ↓ child / → next depends / ← supporting evidence |

---

## Testing & verification · 테스트·검증

```bash
npm run smoke          # env-independent smoke suite (24/24)
npm run test:mcp       # SDK-less unit: store / serialize / confirm-gate (7/7)
npm run test:mcp:e2e   # real stdio spawn — listTools (22) + propose→confirm round-trip
npm run test:mcp:all   # build + logic + e2e in one shot
npm run test:purpose   # purpose-level e2e — web↔MCP concurrent edit, single source of truth (9/9)
npm run test:features  # feature e2e — delta read · attachments · drift · self-confirm guard · md round-trip (12/12)
```

> The `vitest` suite is currently non-functional in this environment (rollup native binary OS mismatch). `smoke.mjs` is the env-independent stand-in. `vitest`는 현재 환경에서 rollup 네이티브 불일치로 미동작 — `smoke.mjs`로 대체.

Templates ship pre-built with node counts: `writing` (11), `novel` (22), `essay` (14), `sns` (17), plus `saas`/`mobile`/`marketing`/`okr`/`agent-harness`/`code-review`/`decision`.

---

## Directory structure · 디렉토리 구조

```
ubp/
├── BLUEPRINT.md                — UBP's own policy (self-applicable) · 자체 정책
├── README.md                   — this document
├── web/
│   ├── whiteboard.html         — main UI (single file, no build) · 메인 UI
│   ├── dashboard.html          — compliance dashboard
│   └── plan.html               — progress plan dashboard
├── src/
│   ├── core/types.ts           — Blueprint · Edge · Attachment types
│   ├── core/anchors.ts         — deliverable ↔ BP traceability
│   ├── core/compliance.ts      — match-rate / manual-correction stats
│   ├── mcp-server.ts           — MCP stdio (22 tools)  ← npm run build
│   └── server/
│       ├── index.ts            — SaaS REST + SSE        ← npm run build:server
│       └── storage/
│           ├── interface.ts    — BlueprintStorage interface
│           ├── filesystem.ts   — .blueprint/ directory (MCP store)
│           ├── supabase.ts     — Supabase REST + Storage
│           ├── supabase.sql    — DDL + RLS + SECURITY DEFINER
│           ├── postgres.ts
│           └── turso.ts
└── package.json
```

---

## License & contributing · 라이선스 · 기여

Internal tooling stage. Issues/PRs follow the `BLUEPRINT.md` guidance and are submitted through the proposal-queue (Confirm Gate) model.

사내 도구 단계. 이슈·PR은 `BLUEPRINT.md` 가이드에 따라 propose 큐(Confirm Gate) 기반으로 제출.
