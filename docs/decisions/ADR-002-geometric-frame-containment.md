# ADR-002: Group membership by geometric containment, not selection set

## Status
Accepted

## Date
2026-06-10

## Context · 배경
UBP needed a "group these nodes" affordance (right-click → 묶기, ⌘G). A group is rendered as a dashed `.frame` container. The core question: **what defines membership** — the set of nodes selected at group-creation time, or the nodes that geometrically sit inside the frame box?

A "group" in UBP is not a new entity type. It is a normal node with `role:"section"` plus `attrs.frame:{width,height}` (`groupSelected()`, `web/whiteboard.html:4365`). Containment is expressed through the existing `parent` edge — the same edge type used everywhere else in the graph. So grouping had to reuse the graph's existing parent/child semantics rather than introduce a separate "membership" list.

그룹은 별도 엔티티가 아니라 `role:section` + `attrs.frame` 노드이며, 소속은 기존 `parent` 엣지로 표현된다.

## Decision · 결정
**Membership is purely geometric and continuously reconciled.** `applyFrameContainment(frameId)` (`web/whiteboard.html:6875`) rewires `parent` edges based on whether a node's **center point** falls inside the frame's box:

- For each non-root node, compute its center (`centerOf()` for cards; frame-box center for nested sections).
- `inside = center within [x1,y1]–[x2,y2]` of the frame.
- If inside and lacks a parent edge → add `{from:node, to:frame, type:"parent"}`. If inside with a different parent → repoint to this frame.
- **If a node was this frame's child but its center is now outside → its parent reverts to `n_root`** (`web/whiteboard.html:6919`).

Selection at group-creation time only seeds the frame's **initial size** (bounding box of the selection + padding). After that, membership follows geometry: drag a node out and it leaves the group; drag one in and it joins.

**Nesting** is supported: sections may live inside other sections. When a node's center is inside multiple frames, the **deepest (smallest-area) frame wins** (`web/whiteboard.html:6914`), and an `isAncestor()` cycle guard prevents a frame from being captured by its own descendant (`web/whiteboard.html:6889`).

## Alternatives Considered · 대안
### Membership = explicit selection set at creation
- Pros: deterministic; moving a node doesn't silently change groups.
- Cons: requires a *second* source of truth (a membership list) alongside the `parent` edges, which can drift from the visual frame. A node visually inside a frame but not in its list is a confusing lie.
- Rejected: violates single-source-of-truth. The frame box *is* the membership UI; geometry keeps the visual and the data identical.

### Membership = explicit, but auto-add on drag-in only (no auto-remove)
- Rejected: asymmetric. Nodes accumulate in groups and never leave, so frames become stale. Symmetric geometric reconciliation is simpler to reason about.

### A dedicated `group` node type / `member` edge type
- Rejected: adds graph vocabulary that the MCP layer, exporters, and policy parser would all need to learn. Reusing `role:section` + `parent` means **zero** downstream changes — frames serialize, export, and traverse like any other parent/child subtree.

## Consequences · 결과
- **One source of truth:** the frame box. There is no membership list to keep in sync; what you see contained is what is parented.
- **Predictable UX:** moving a node in/out of a frame box changes its group, every time, in both directions.
- Frames nest and serialize for free — MCP `read_blueprint`, exporters, and `Blast Radius` traversal treat a frame's subtree like any other parent/child tree.
- **Gotcha — geometry is authoritative, so manual `parent` edits to a contained node can be overwritten** the next time `applyFrameContainment` runs for that frame (e.g. on group create / resize). If you need a parent relationship that contradicts the visual box, don't place the node inside the box.
- **Gotcha — center-point test, not overlap:** a large node straddling a frame edge belongs to the frame only if its *center* is inside. Partially-overlapping nodes are intentionally excluded to avoid ambiguous dual membership.
- Reconciliation is O(nodes) per `applyFrameContainment` call and runs on group create/resize, not per-frame-render — bounded for the single-user canvas sizes UBP targets.
