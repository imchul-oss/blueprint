# ADR-001: Three preset systems with context-gated surfacing

## Status
Accepted

## Date
2026-06-10

## Context · 배경
The whiteboard (`web/whiteboard.html`) accumulated three distinct "give me a starting structure" affordances that, to a new reader, look redundant and were at risk of being merged or deleted:

1. **시작 템플릿 (Start Templates)** — 11 full blueprints (`TEMPLATE_LIST` / `loadTemplate()`). Selecting one **replaces the entire canvas** (`BP` is rebuilt from scratch).
2. **팔레트 스텐실 (Palette Stencils)** — draggable card *sets* (`STENCIL_PRESETS` / `applyStencilPreset()`). Selecting one **only swaps the palette card set** (`STENCIL_CATEGORIES`), leaving the canvas untouched. Cards are then dragged/clicked to spawn individual nodes.
3. **명령 팔레트 (Command Palette)** — `PALETTE_ACTIONS` (⌘K), a verb list for one-off actions (incl. "공백으로 시작").

The three operate at **different scopes** (whole-canvas / palette-only / single-action) but were surfaced through overlapping UI, so users (and future agents) could not tell which one destroys their work. The trigger for this ADR: a user reported that template selection was wiping an in-progress canvas unexpectedly.

세 가지가 각기 다른 **범위**(전체 캔버스 / 팔레트만 / 단발 액션)에서 동작하지만 UI가 겹쳐, 어느 것이 작업을 날리는지 구분이 안 됐다.

## Decision · 결정
Keep all three — they serve genuinely different scopes — but **gate their surfacing by canvas state** and **route them through one typed dispatcher**:

- A single palette dropdown lists both stencils and templates via a `prefix:KEY` value scheme. `onStencilSelectChange()` routes by prefix (`web/whiteboard.html:7300`):
  - `stencil:KEY` → `applyStencilPreset()` (palette-only swap, non-destructive)
  - `tpl:KEY` → `loadTemplateGuarded()` (whole-canvas replace, guarded)
- **시작 템플릿 optgroup is shown only when the canvas is blank** (`isBlank = BP.nodes.length <= 1`, `web/whiteboard.html:5151`). While work is in progress, the dropdown offers stencils only; the placeholder text also switches (`프리셋·템플릿 선택…` vs `팔레트 스텐실 선택…`).
- When a destructive replace *is* requested on a non-empty canvas (template from the dropdown, or "공백으로 시작" from the command palette), it passes through a **confirm guard** (`loadTemplateGuarded` / `startBlankGuarded`, `web/whiteboard.html:7285`) noting it is undoable.
- **공백으로 시작** is reachable only from the welcome screen card and the command palette — deliberately **not** in the dropdown, to keep the dropdown's two optgroups conceptually clean (card-set vs full-replace).

## Alternatives Considered · 대안
### Collapse into one "presets" menu
- Rejected: the three differ in blast radius (whole-canvas wipe vs palette swap vs single node). One menu would hide the destructive/non-destructive distinction — the exact confusion that triggered this ADR.

### Always show templates in the dropdown
- Rejected: invites accidental full-canvas replacement mid-work. Context gating (blank-only) removes the foot-gun while keeping templates one click away when they're actually wanted (empty canvas).

### Drop stencils, keep only full templates
- Rejected: stencils are the incremental authoring path (drag one card at a time onto an existing graph). Removing them forces all-or-nothing starts.

## Consequences · 결과
- New readers can reason about scope from the UI: dropdown optgroup labels state the blast radius (`카드 세트만 교체` vs `캔버스 전체 교체`).
- The `prefix:KEY` dispatcher (`stencil:` / `tpl:`) is the single extension point — adding a preset means adding to `STENCIL_PRESETS` or `TEMPLATE_LIST`, no new handler.
- **Gotcha:** `isBlank` is evaluated at `buildStencilPanel()` time. The dropdown does not live-update when the canvas transitions blank↔dirty; it refreshes on the next panel rebuild. Acceptable because panel rebuilds happen on tab switch / preset apply.
- Destructive paths are uniformly guarded + undoable (`saveState` before replace), so a mis-click is recoverable via ⌘Z.
