# PL/NTH 3D Kitchen Planner

A self-contained, offline 3D kitchen planner for Plinth. Customers enter their
room, drop in PL/NTH blocks, pick a finish, see it in 3D, and email the order to
`hello@plinthmade.com`. Everything is procedural Three.js — no imported models,
no external APIs, no logins, no shopping cart.

## Run it

ES modules + an import-map need to be served over HTTP (not `file://`):

```bash
npm run dev        # python3 -m http.server 8080
# then open http://localhost:8080
```

Three.js loads from a pinned CDN via the import-map in `index.html`, so there is
no build step. To self-host Three (fully offline in production), download
`three@0.160.0` and point the import-map at local paths.

## Test

```bash
npm install        # installs three (dev-only, for the node tests)
npm test           # units + integration + build-all-SKUs
```

## How it's organised

```
index.html                 standalone page + Three import-map
src/main.js                bootstrap — wires store ↔ scene ↔ UI
src/core/
  units.js                 inch helpers + fraction formatting (unit-tested)
  catalogue.js             ~70 blocks, 15 finishes, customer pricing
  store.js                 layout state + pub/sub
  persistence.js           localStorage autosave + JSON export/import
  cost.js                  customer estimate + unit list
  order.js                 mailto order to hello@plinthmade.com
src/scene/
  Scene.js                 renderer, camera, OrbitControls, studio lighting
  Room.js                  floor + back/left walls from the footprint
src/models/
  materials.js             cached materials (paint reflections capped)
  cabinet.js               parametric cabinet builder (front=+Z, base=y=0)
  worktop.js               representative worktop over base runs (unpriced)
  knob.js                  brass knob placeholder
src/interaction/
  cabinets.js              store→scene sync + per-frame grounding guard
  snapping.js              wall snap + edge-to-edge run snapping (pure)
  controls.js              pointer select / drag / rotate / delete
src/ui/
  ui.js                    panels: room, catalogue, finishes, cost, order
  styles.css               PL/NTH brand styling + mobile bottom sheets
test/                      node test suites
```

## Conventions baked in

- **Inches everywhere.** 1 world unit = 1 inch. One tested mm→in helper covers
  the few spec constants published in mm (22mm panels, 18mm shelves, 115mm
  plinth, drawer faces).
- **Orientation:** every cabinet is authored front-facing +Z, base at y=0,
  centred on x — so placement, snapping and worktops are predictable.
- **True colour:** painted materials cap `envMapIntensity` so a chosen finish
  reads true rather than washing out under the studio environment.
- **Always seated:** a cheap per-frame guard re-grounds every cabinet to its
  mount height (floor/tall = 0, wall = 54", counter = on the worktop).
- **Pricing is customer-facing only.** Sell $ = (workshop GBP + £20 wrap) ×
  1.32 × 2. Workshop GBP, margin and container maths are never shown.

## Known v1 simplifications / next steps

- Worktops are one slab per base unit (they butt into a continuous look) — a
  true merged run with end-overhangs is a later refinement.
- Corner units render a return leg but their worktop is approximate.
- Room is a rectangle with two visible walls (back + left); good for straight,
  L-shape and island layouts. Free-standing islands snap to each other.
- Catalogue prices cover F1–F28 / W / C / T from the costing tool; newer sink
  base / drawer+door SKUs (F29–F34) on the spec sheet need prices before adding.
```
