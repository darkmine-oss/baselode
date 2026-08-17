# TRK-389 — Responsive dig-block optimisation

## Intent

Add a reusable, deterministic first-pass dig-block partitioner and a 2D demo
that recomputes while planning controls move. The solve targets tonnes and Fe
head grade while favouring contiguous, direction-aligned blocks with a wide
excavator entry face.

## Algorithm

- Select block-model cells whose centres fall inside one convex blast polygon.
- Rotate centres into mining coordinates: forward is the bearing clockwise
  from north; cross is the entry-face direction.
- Divide the blast into forward bands sized from target tonnes and the desired
  face-width/depth ratio.
- Use dynamic programming inside each band to choose contiguous cross-direction
  cuts. Score tonnes error, tonnes-weighted Fe error, face geometry, geology
  mixing and hardness variation.
- Intersect every direction-aligned rectangle with the blast polygon and return
  polygons, cell assignments, block physicals and aggregate score metrics.
- Keep the solver pure and independent of React/Three.js.

## Source-data decision

MineLib Newman1 was evaluated as the user-suggested example. Its block file has
`x`, `y`, `z`, type, grade and tonnes, but its own documentation says the block
size and metal type are unknown. The download is also intended for academic use
rather than redistribution. Baselode therefore documents the mapping but does
not bundle or silently invent the missing physical dimensions; the demo uses a
clearly labelled, redistributable synthetic iron-ore bench instead.

## Demo

- Generate a deterministic synthetic, single-bench iron-ore block model and an
  approximately 200 kt convex blast outline.
- Show grade-coloured source cells, generated dig polygons, dig direction,
  labels, selection details and live outcome cards in an SVG plan.
- Recompute immediately for target tonnes, target Fe, direction, objective
  weights, face/depth ratio and minimum face width controls.

## Verification

- Unit-test deterministic output, assignment coverage/uniqueness, target
  physicals, polygon containment, direction response and invalid input.
- Run the JavaScript package verification and demo production build.
- Manually exercise the new route at desktop width and confirm responsive
  updates and readable selection/summary feedback.
