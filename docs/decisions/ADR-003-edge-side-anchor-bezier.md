# ADR-003: Edge rendering — side-intersection anchors + cubic bezier, containment edges suppressed

## Status
Accepted

## Date
2026-06-11

## Context · 배경
Edges were drawn as straight `<line>` segments between **node center points**. The SVG layer sits below node divs (z-index 1 vs 5+), so the visible segment "emerged" from under the node border at an angle-dependent point. Three user-facing problems:

1. Connection affordances (ports, ghost arrows) live on the node **edge**, but the resulting wire attached to the **center** — a visual mismatch.
2. Frame-containment `parent` edges (card → section) were *accidentally* hidden because the straight center-to-center line lay entirely under the frame div. Any rendering change that escaped the frame box (e.g. curves) would expose them.
3. Center-to-center lines look diagram-poor next to layered (tree) layouts.

엣지가 노드 중심-중심 직선이라 포트 어포던스(가장자리)와 결과물(중앙 부착)이 불일치했고, frame 안 parent 엣지는 z-order 우연으로만 가려져 있었다.

## Decision · 결정
`drawEdges()` (`web/whiteboard.html`) renders each edge as a **cubic bezier `<path>`** between **side anchors**:

- **Anchor = intersection of the center-to-center line with the node's rounded rect**, snapped to the chosen side and clamped to 80% of that side's length (`anchorOf()`). Side selection is aspect-corrected (`|dx|·hh ≥ |dy|·hw` → left/right, else top/bottom), so it behaves naturally in tree, grid, *and* radial layouts without per-layout branches.
- Because the anchor is the **intersection point, not the side midpoint**, multiple edges leaving one node distribute along the side instead of bundling at a single point.
- Control points extend perpendicular from each anchor's side by `clamp(distance·0.4, 24, 120)` (`edgePathD()`) — the xyflow / JSON Canvas visual convention. Labels sit at the bezier `t=0.5` point.
- The drag temp-line uses the same `anchorOf()`, so what the user sees while dragging matches the created edge.
- **Containment `parent` edges (child center inside its section's frame box) are skipped at render time**; nesting *is* the visual representation (see ADR-002). While a node is being dragged, its parent→section edges are suppressed unconditionally — containment is re-evaluated at drop, and drawing the stale edge mid-drag only produces flicker. The hover-target highlight shows the drop destination instead.
- Style lives in a single `EDGE_STYLE` constant shared by the canvas renderer and both edge popups (create / edit), with per-type swatches in the picker.

## Alternatives Considered · 대안
### Keep center-to-center lines, clip at node border (pure intersection, straight lines)
- Pros: smallest change, layout-agnostic.
- Cons: still diagonal clutter on layered layouts; does not fix the port-affordance mismatch feel; containment edges still exposed once endpoints move to borders.
- Rejected as a half-measure — the bezier step costs little more.

### Side-midpoint anchors (classic L→R tree style)
- Tried first. **Rejected after a live screenshot showed edge bundling**: every edge to targets on one side attached at the exact same midpoint, producing a fan/knot at busy nodes. The intersection-point anchor keeps the side semantics while distributing attachment points.

### Orthogonal (elbow) routing
- Rejected for now: requires obstacle avoidance to look good, much higher complexity; bezier achieves the "node editor standard" look at O(1) per edge.

### Keep drawing containment edges (rely on z-order)
- Rejected: the old invisibility was an accident of straight-line geometry. Encoding "nesting = the visual" as an explicit render rule is honest and survives future rendering changes. Data is untouched — drag the card out and the edge re-appears anchored to the real frame border.

## Consequences · 결과
- Hit areas, selection highlight, and hover styles moved from `line` to `path` selectors (CSS already covered both).
- `centerOf()` had to become section-aware (frames carry `data-frame-id`, not `data-id`; sizes come from `attrs.frame`) — fixing a latent "phantom 224×88 box" bug that the anchor change exposed.
- Frame outline color/style became user-visible alongside this work: `--frame-color` must be a **complete color value** (an HSL triple silently invalidates the whole `border` shorthand via `color-mix()`), defaults to the accent mint via the `--color-section` token chain, and style/width are configurable (`frameBorderStyle`/`frameBorderWidth` UI tokens).
- Performance unchanged: anchors reuse the `_sizeCache` + rAF-throttled drag pipeline.
