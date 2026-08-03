# PL/NNER — the PL/NTH kitchen planner

Self-contained, offline 3D kitchen planner + trade ordering system for PL/NTH,
a **US** painted-cabinet company (US English, USD, dimensions in **inches**
everywhere in app code — the DXF export alone is millimetres).
Embeds at plinthmade.com. Two faces: HOME (consumer design) and TRADE
(multi-unit spec/order for developers).

## Run / test

- Dev server: `python3 -m http.server 8080` in this folder → http://localhost:8080
- Tests: `npm test` (node:test; ~22 files, must stay at **0 failures**).
  Every new test file must be added to the `"test"` script in package.json.
- NO build step. Vanilla JS ES modules + Three.js r160 vendored via import-map.
  No external CDNs, no runtime network except Supabase REST. Never add
  dependencies or a bundler.

## Architecture

- `src/core/` — PURE modules, node-testable, no DOM/Three. Layout generator
  (`layouts.js` — generateKitchen(shape, room, seed, opts), seeded,
  personalities), catalogue, cost, budget ladder, rationale, warnings,
  spec check (`speccheck.js`), fillers, cornice, worktop math
  (`worktop-plan.js`), submittal math, orders/invoice/phasing/tradebook,
  `xlsxmini.js` (dependency-free .xlsx writer), `dxf.js`, cloud REST
  (`cloud.js`, `tradecloud.js`), config (Supabase keys — anon, public by design).
- `src/models/` — Three.js cabinet/worktop/decor construction
  (`cabinet.js` buildCabinet is the geometry heart).
- `src/interaction/` — drag/snap (`snapping.js` returns {x,z,rotDeg,flag};
  flags: 'window'/'sink'/'offwall'/'corner').
- `src/scene/` — Scene, lighting, walkthrough.
- `src/ui/` — DOM only: ui.js (CABINETS/ROOM tabs), wizard, floorplan
  (plan SVG + branded PDF sheets), submittal sheets, invoice, trade tab,
  picker, frontdraw (shared 2D cabinet-front SVG renderer), styles.css.
- `test/` — every hard rule below is enforced by sweep tests
  (all 5 shapes × sizes × seeds). Keep them green; extend them with any new rule.

## Hard product rules (client-mandated — never regress)

1. Nothing overlaps anything, ever (drag + generator).
2. Cabinets never cover a window (sink/hob appliances exempt under windows).
3. Cooker/range never at a wall end or corner; guarded by landing cabinets.
4. Corner cabinets only at right angles with a partner run, sitting LEG-TO-LEG:
   the corner unit's BODY starts exactly where the perpendicular run's boxes
   end (24.25" off the side wall), so the two front frames meet 22mm leg to
   22mm leg with the FULL door stile showing; the blank return hides behind
   the perpendicular run and stretches to meet the adjacent wall (never cut
   off, never z-fighting its own carcass — the carcass sits behind the face).
   When a tight wall DROPS the corner unit, the back run reserves the leg's
   DEAD-CORNER SHADOW (24") so perpendicular runs never crash — and if even
   sink + shadow won't fit, the leg is dropped (L degrades to straight).
   BOTH corners of a U sit exactly leg-to-leg. Run residual (the sliver) is
   absorbed the fitter's way: the RIGHT LEG pulls off its wall by the sliver
   (<= 5.5") and its worktop deepens to the wall — invisible; only a bigger
   sliver falls back to a priced mid-run filler beside the corner door.
   Mid-run fillers are first-class: computeFillers emits them (gap <= 9"
   between run neighbours), the worktop spans them (CONNECT 9.6).
5. Wall/tall/counter cabinets sit against walls; counterstanding units within
   ~4.5" of a wall snap back to touch it. TALLS stand 30mm PROUD of the base
   run (TALL_PROUD in snapping.js — drag-snap AND generator placements), so
   the worktop dies into the tall's side, never past its face.
6. Sink never directly beside a cooker; essentials (sink base, bin, DW) always present.
7. Plinth is FLUSH to the floor — no setback/shadow band. 115mm plinth zone.
8. Worktops: continuous into room corners; span scribe fillers; **never** over
   an appliance footprint (butt range/fridge sides exactly); STOP DEAD at a
   butting TALL's face (the front frame leg) — the 1" side overhang belongs to
   open run ends only, never riding past a tall.
9. Crown/cornice runs over tall fillers and drops down sides to meet uppers.
   Where an upper sits beside a TALL (butted or within 2.5"): the upper's
   crown EXTENDS across the gap and DIES INTO the tall's flank (no floating
   side return), the vertical connector on the flank runs from the ROOM
   WALL (talls stand proud) forward past the upper's face, and the TALL'S OWN
   crown runs back along its flank ABOVE the upper — crown concealment is
   HEIGHT-AWARE (insideAnother only respects neighbours whose crown line is
   at least as high).
10. Islands: 44" walkways hard minimum; double-sided (24"+24" back-to-back,
    storage-only back row) whenever it fits; island tab offers FLOOR cabinets
    plus island-appropriate APPLIANCES only (range / hob / sink — hoods and
    fridges still need a wall; ui.js _catalogueHTML whitelist).
11. Freestanding fridge (user-sized, AP9:WxDxH virtual codes) parks at run end.
12. Wizard: dimensioned door/window input, appliance interview
    (range vs wall oven+cooktop / integrated vs freestanding fridge / 1-2 DW).
13. F10 is 36" wide (master spec). NEVER rename/reprice SKUs in catalogue.js —
    they're the client's real product names.
14. PDFs carry the dims-responsibility disclaimer (PL/NTH does not survey).
15. DISHWASHER LEGS: the F7 panel is LEGLESS — it must sit BETWEEN two
    leg-bearing cabinets (FLOOR/TALL, incl. a corner unit's door side) whose
    22mm legs it borrows. Never at a run end, never first at a corner
    junction, never beside an appliance. Generator guarantee for walls >= 124"
    (enforceDishwasherPlacement in layouts.js, reseats within 56" of the sink);
    tighter walls best-effort + live warning (warnings.js).
16. RANGE CLEARANCE: at least 18" of counter between any cooking appliance
    (range AP1-3, or a hob AP4-5 on its base) and any TALL / COUNTER unit or
    freestanding fridge. Generator guarantee for rooms >= 112"x112"
    (enforceRangeClearance in layouts.js + side-leg landing reservation);
    tighter rooms get best effort + a live warning (warnings.js, which also
    flags a tall lurking just around a corner from the range).
17. HARDWARE IS SUPPLY-ONLY (client mandate 2026-07-14): cabinets ship
    UNDRILLED, hardware by others. Knobs in the 3D/elevations are visualization
    only — every schedule/order doc says "By others — cabinets supplied
    undrilled". Never reintroduce a hardware picker or priced hardware.
18. STACKERS (S1–S32, stacker: true): hung boxes that sit ON TOP of a host
    run, matched per family — tall hosts (mountY 86, d 25.25" so the face
    lands flush with the 30mm-proud tall), wall hosts (mountY 84, d 14),
    counter hosts (mountY 86.5, d 14) — in ALL host widths × 15"/21" heights.
    Descs name the HOST CODES ('Stacker 15" (fits T1, T3)') — never host
    dimensions; desc↔host accuracy is test-locked. Stackers have their OWN
    display family ('STACKER' via familyOf() — behavioural type stays WALL):
    own picker chip + own catalogue section; schedules/plan KEY label them
    'Stackers'.
    EVERY non-corner wall/tall/counter cabinet must have an exact-width
    stacker at its top (sweep-locked in trade-upgrades.test.js — add stackers
    when adding host widths). Never floor-standing; stackers swap only with
    stackers on the same host (swapAlternatives). warnings.js errors when any
    cabinet top exceeds the ceiling. Crown runs over them height-aware.
19. PANEL-READY: T10/T11/T12 column housings (24/30/36", panel kit included,
    undrilled) + F29 undercounter panel (form 'dishwasher' → legless, borrows
    neighbours' legs like F7). Appliances still never supplied.
20. VOLUME TIERS (indicative, confirmed on quote): catalogue.js VOLUME_TIERS
    by total unit count (10+/25+/50+/100+ → 3/5/8/10%), cent-rounded discount
    in tradeSummary; flows to snapshot totals, invoice charges, change-order
    reconciliation (net = type deltas + shipping delta − discount delta), CSV,
    workbook, email. Tune percentages ONLY in VOLUME_TIERS.
21. Custom RAL: FINISHES has 'Custom RAL' (custom: true) + trade.finishRal
    code input; docs print "Custom — RAL <code>".
22. Submittal packs carry CSI section 06 41 00, a PROJECT DIRECTORY
    (trade.address/architect/gc/owner), an approval stamp box, and sheet A-600
    COMPLIANCE & PRODUCT DATA (TSCA VI/CARB2 language — Imogen must verify
    claims with the workshop before first real issue). Docs open via a hidden
    IFRAME print (openPrintWindow) — never window.open (popup blockers).
23. Trade UI is emoji-free (print docs were always ASCII-safe; the console now
    matches). The ✎ pencil and ✓/× glyphs are brand, keep those.
24. Show-kitchen-first phasing: planPhases opts.showKitchenFirst (UI checkbox
    when phasing is on) pulls ONE unit into its own Phase 1 "Show kitchen —
    first delivery"; unit/cabinet totals must never change.
25. Revit: buildUnitIFC (src/core/ifc.js) exports IFC4 in INCHES (client
    mandate; IfcConversionBasedUnit 'INCH' = 0.0254 m — Revit-native), one
    storey per unit type, appliances included — trade "Revit / IFC" button.

## DXF conventions (calibrated to client's gold file)

`buildCabinetLibraryDXF()` emits a **3D model in mm** matching the client's
reference ('PLINTH F1 F10 F20' — F1/F20 match vertex-for-vertex): R12 ASCII,
POLYLINE polyface meshes only, layers BODY (5×18mm carcass panels, modelspace)
/ FRONT (block `<CODE>_FRONT_FACE`: 22mm end strips, 35mm top rail, 115mm
plinth box, 80mm mitred shaker frames with negative-index invisible edges,
panels recessed to y=5, drawer slabs 315/245/315→175 top with 2mm gaps,
legless dishwasher) / LABEL (TEXT at footprint centre). `buildPlanDXF` stays
2D inches. Verify with ezdxf (audit must be 0 errors).

## Branding / UI conventions

PL/NTH + PL/NNER same font size; "✎ Sketch my kitchen"; "Back to the drawing
board" re-roll; tabs CABINETS/ROOM; trade dark theme; no emoji tofu-risk glyphs
in print CSS (ASCII-safe); esc() for XML (`Dishwasher Door & Plinth`).
Money maths in integer cents (invoice.js). Rev letters A→B→…→Z→AA per unit
with dated history; order numbers `PL-YYMM-XXXX` (base32, no 0/O/1/I).
Knobs: every hinged door carries its knob at MID-HEIGHT on the leading edge
(client spec — never tucked into a top/bottom corner); drawer knobs centred
per face (models/cabinet.js knobY).

## Supabase (project quzjzgllwjrkynapeuzi)

Plain-fetch REST, no supabase-js. Tables: `designs` (owner RLS), `leads`
(insert-only). SQL files at repo root the owner runs in the SQL editor:
- `SUPABASE_TRADE.sql` — trade_projects + get_shared_project (share links `?tshare=`)
- `SUPABASE_ORDERS.sql` — trade_orders + admin_users + set_order_status/cancel_order
  (**owner must insert her auth user id into admin_users** — marked in the file)
- `SUPABASE_DOCS.sql` — order_documents issuance ledger (function-only access)
Check with the owner which of these have been run. Cloud is always optional:
every feature degrades gracefully offline (mailto order fallback etc).

## Trade feature map (all shipped)

Unit types with floors/counts → per-unit design (or manual order table with
visual picker + live spec check) → submittal packs (A-000 cover, A-100 plan,
A-2xx library-style elevations via frontdraw.js, A-300 schedules, A-4xx cut
sheets, A-5xx MEP rough-in), rev bumps → delivery phasing (batches ≤N units,
+2wk offsets) → order CSV / XLSX workbook (xlsxmini) / DXF → real orders
(status pipeline submitted→confirmed→in_production→shipped→delivered, admin
dropdowns, buyer cancel while submitted) → docs hub (regenerate paperwork from
the **frozen order snapshot**, never live state; issuance log) + pro-forma
deposit/balance invoices (50/50, odd cent to deposit, balance due 14 days
before Phase 1 window) → change orders (`core/changeorder.js` diffs the frozen
order against the LIVE working spec — the one deliberate exception to
never-read-live-state; rev-to-rev per unit type, added/removed/qty/reprice
lines, cents-exact reconciliation, CO-YYMM-XXXX-N numbered off the issued log,
sign-off sheet, logged as kind 'change_order').

## Build history tail

W2W-35 DXF elevations → 36 DXF 3D gold calibration → 37 3D fixes (corners,
worktops-into-corners, cornice-over-fillers, counter snap) → 38 double islands
+ worktop-never-over-ranges → 39 submittal packs → 40 library-style elevations
+ visual picker → 41 spec check + rough-in + phasing → 42 cloud projects,
share links, XLSX → 43 orders + status → 44 docs hub + invoices →
45 change orders → 46 trade voice (wizardVoice in ui/wizard.js: the same
wizard speaks HOME to homeowners and TRADE to pros while a unit-design
session is open — TradeUI.designingUnit() is the signal; the topbar
"Sketch my kitchen" button, first-run tour and sign-in modal re-voice too;
locked by tradevoice.test.js) → 47 corner render + trade clarity (corner
blank-return front no longer z-fights its carcass — the carcass sits behind
the face; SKIN hairline setbacks on all carcass/appliance sides so butted
boxes never share a plane; worktop covers the STRETCHED drawn return, not
just the 20" SKU; result bar redesigned — one action row, rationale folded,
dies on trade switch/design finish/stage touch; trade cards lead with a
"Lay out this unit in 3D" invite + 1-2-3 flow strip) → 48 leg-to-leg corners
(client spec, hard rule 4: corner BODY at 24.25" off the side wall so the
frames meet 22mm leg to 22mm leg, full stile showing; generator budgets
CORNER_RETURN 24.25 + wizard legFit shifts the back run; side runs start at
24.3; snap tip tolerance 10" to match the drawn-return stretch; oak back
panel inset between the side panels — its raw edge used to z-fight through
exposed painted sides) → 49 range clearance (hard rule 16) + master-library
legs on the 2D fronts (frontdraw: ink legs + outlined door leaf) → 50 plan
front frames drawn leg·door·leg (floorplan ticks; dishwasher stays legless)
+ worktop stops dead at a butting tall's face → 51 mid-height knobs (every
hinged door: knob at mid-height on the leading edge) → 52 talls 30mm proud
(generator side/facing-run placements now match the drag-snap TALL_PROUD) →
53 dishwasher between legs (hard rule 15: legless F7 reseated between two
leg-bearing cabinets, within 56" of the sink; live warning for hand-drags) →
54 dead-corner shadow (cornerless tight-wall L: back run reserves the leg's
24" shadow / degrades to straight; perpendicular-clash sweep locked) → 55 both
corners leg-to-leg → 56 mid-run fillers (computeFillers fills gaps BETWEEN
run neighbours too; worktop spans them) → 57 sliver hides behind the leg
(U residual <= 5.5": the right leg pulls off its wall, worktop deepens to
the wall — the fitter's trick; bigger slivers keep the mid-run filler) →
58 tray slot (F8 shelf-less) + cornice drop reaches the wall → 59 crown dies
into the tall (upper's crown extends across a <=2.5" gap to the tall's flank,
side return suppressed) + wall-cabinet drag (hung cabinets ALWAYS attach to
the nearest wall — no threshold, no offwall fighting; hung butts hung only) →
60 tall crown runs back (height-aware concealment) + clear glass (blend-only
transparency, opacity 0.16 — transmission+opacity read as murk) → 61 glazed
doors match plain doors exactly (full-depth stiles/rails + the same 8mm-proud
face frame, glass replacing ONLY the centre panel — never a recessed leaf) →
62 trade upgrades for institutional buyers (hard rules 17–25: A-600 compliance
sheet + 06 41 00 + project directory + approval stamp on submittals; hardware
supply-only/undrilled; stackers S1–S32 matched to every wall/tall/counter host + ceiling warning;
panel-ready T10–T12 + F29; indicative volume tiers threaded through pricing,
snapshot, invoice, CO reconciliation; Custom RAL + trade.finishRal;
show-kitchen-first phasing; IFC/Revit export src/core/ifc.js; popup-free
iframe printing; de-emoji'd trade console; production-slot lead-time voice;
trade fields address/architect/gc/owner on trade state + snapshot projectMeta; 'Certainty at scale' positioning section in the trade panel (whyHTML in trade.js — pitch certainty, never prestige);
tests ifc.test.js + trade-upgrades.test.js, 29 files green; SINK-BASE TOP RING: a sink base's top panel is no longer fully removed — it becomes a perimeter ring (front/back rails 1.75", side strips 0.75", middle open for the bowl) so the front slot between door top and worktop underside is closed — never restore the skip-entire-top behaviour, and never a full panel either (white plane under the cutout)).
→ 63 worktop appliance clamp SUBTRACTS (worktop-plan.js: appliance overlap now cuts an L-notch
via 4-piece rectangle subtraction — the old cheapest-edge shave stripped the front inches off an
ENTIRE corner-turning run when a range sat near the corner; overhang-lip-thin cut pieces are
dropped so the 1" lip still stops dead at a range, never runs across its front; regression
locked in trade-upgrades.test.js with Imogen's real L-kitchen).
→ 64 Rockledge gaps (2026-07-20, from drawing real MH plans): NEW AP11 Integrated
Fridge-Freezer 36" (french doors + freezer drawer, 84" install height, 24" counter
depth, integrated:true → panel-look painted fronts w/ shaker fields + knobs in
appliances.js — NOT stainless; pairs with T12 when Plinth supplies the housing);
island picker now offers APPLIANCES (range/hob/sink whitelist — Rockledge islands
cook; hood/fridge still wall-only); build.test.js appliance count 10→11 + AP11
dim/panel assertions.
→ 65 cooktop bases F30/F31 (2026-07-20, Rockledge: 36" is the standard rangetop
there): F30 Cooktop Drawers (3) — fronts IDENTICAL to F20, top front FALSE (workshop
detail, never visual); F31 Cooktop Double — F10 carcass prepped for the cooktop
body. Both 36", desc-named so classify() reuses the F20/F10 forms. gbp mirrors
F20/F10 — ASSUMED, workshop to confirm. warnings.js now flags a hob over a working
drawer bank / plain double and points at F30/F31. build.test.js asserts forms+dims.
→ 66 T13 Tall Double 44" (plain full-height L+R door pair — desc 'Double' so
classify() reuses the tall-aware double form; £1,650 ASSUMED, workshop to confirm);
AP12 Integrated French-Door FF 36×25×72 (fits Fisher & Paykel RS36A72 — the 72"
sibling of AP11); AP13 Integrated Over-Under FF 30×24×84 (`overUnder:true` → ONE
door over the freezer drawer in the integrated fridge model; Sub-Zero DET50 idiom).
→ 67 integrated fridges REDRAWN properly (her catch: "they look terrible... same shaker
panels and 22mm legs as all the other cabinets"): new buildIntegratedFridge() in
models/cabinet.js — painted shell, flush 115mm plinth, recessed shakerLeaf doors +
drawer with revealRings and knobs, kitchen-finish aware (cabinets.js threads
finishHex into buildAppliance; appliances.js integrated branch DELEGATES to the
cabinet factory — never hand-draw fronts, same lesson as the trade-page SVGs).
→ 68 her catches: (1) TOP RAIL was 22mm in 3D but 35mm in the master drawings —
buildCabinet openings now stop TOPRAIL=mmToIn(35) below the top (every cabinet +
buildIntegratedFridge, which also gains an explicit painted rail bar so the
recessed leaves leave the same shadow line the door sides get); (2) pull-out bin
picker icon had the knob on the hinge edge — bins never hinge; icon.js bin case
now knob-centred on the top rail matching the 3D; (3) 36" drawer banks (F20/F30
+ the fridge freezer drawer) carry a KNOB PAIR, each knob 1/9 of the front width
in from its end (her spec), in BOTH 3D (flatDrawer) and picker (icon.js).
→ 69 trade Save project ADOPTS the existing cloud row by name when cloudId is
missing from local autosave (storage loss / new device previously created silent
DUPLICATES — her catch after the Rockledge project vanished from localStorage
mid-file-update). saveTradeProject: no id → listTradeProjects → newest same-name
row's id adopted → PATCH not POST. "Save project" always means THIS project.
→ 70 exposed island backs now RENDER as finished painted panels (her catch: the
estimate priced 'End panel (finished island back)' but the 3D still showed oak).
endpanels.js gains exposedBackIds(state) (computeEndPanels reuses it); the
cabinet layer passes backPanel:true for those items. Cost and render can no
longer disagree about island backs.
→ 71 CRITICAL: "Edit layout in 3D" stashed the ENTIRE trade project in memory
only — a reload mid-design (or a served-file update) silently destroyed it
(bit Imogen twice on Rockledge). enterDesign now persists the stash to
localStorage 'plnr-trade-stash'; finishDesign clears it; TradeTab boot recovers
an orphaned session (folds the autosaved unit design back onto its unit, then
restores the project, toast confirms). Never keep the only copy of user data
in an instance field.
→ 72 trade-project data safety, round two (her catch: "click done, everything
disappears" — a unit came back 0-items after a design session): three wipe
paths closed. (1) store.clear() reset the WHOLE state — top-bar Clear in trade
mode (or mid-design + Done) destroyed the project; clear() now preserves trade
+ mode and only empties the plan. (2) a stale #d= share hash re-applied itself
on EVERY reload and reset trade to empty units (the GH-Pages tab had a demo
hash pinned in its URL); boot order flipped to loadSaved THEN loadFromHash,
replace() gains {preserveTrade} (a design with no trade key keeps the current
trade), and loadFromHash CONSUMES the hash (history.replaceState) after a
successful load. (3) finishDesign dropped the safety stash while the restored
project sat only in the 250ms-debounced autosave — persistence.js gains
saveNow(store) and finishDesign/_recoverOrphanStash write synchronously BEFORE
removing 'plnr-trade-stash'. Locked by test/data-safety.test.js (also added to
the npm-test chain along with cooker-window.test.js, which had never been
wired in); S7/S14 descs updated to "(fits T7, T8, T13)" — T13's arrival had
broken the stacker desc-accuracy test unnoticed because trade-upgrades ran
late in the chain.
→ 73 email capture at the value moments (her funnel decision 2026-07-23 — planner
ENTRY stays open, take-aways leave an email): dxfgate.js generalized to
ensureEmailGate(source, {title,sub,cta}) + capturedEmail(); ensureDxfEmail keeps
its old behaviour. Newly gated in main.js: plan Print/PDF/SVG (sources plan-print/
plan-pdf/plan-svg), quote Save-as-PDF (quote-pdf — VIEWING the quote stays free,
pricing transparency is the pitch), share buttons (share-link/share-email), and
TRADE entry (trade-entry) via the modeSwitch button and ?mode=trade boot (the
workspace shows immediately, the gate sits over it; bail → home + wizard if the
room is empty). NEVER gate: planner entry, the homeowner wizard, ?tshare approval
views, or internal setMode calls (unit design Done/Cancel). One email unlocks
everything forever (shared localStorage key 'plinthDxfEmail'); signed-in users
pass silently; leads land in dxf_leads with the source string (fallback
contact_messages person_type 'Planner lead'). Order-check email field prefills
from capturedEmail().
ALSO IN 73 — painted top rail closes the tall door gap (her catch 2026-07-23,
"the gap at the top of the tall cabinets is WAY too big"): the 35mm top-rail
zone above every door was 13mm of OPEN SLOT (top panel is only 22mm) plus the
recessed-door shadow, rendering as one deep dark band on talls. buildCabinet
now adds a painted railBar (shellW−2·PANEL wide × TOPRAIL−PANEL tall × PANEL
deep, butted between the side panels and under the top panel's front edge —
butted, never overlapped, nothing z-fights) for every form EXCEPT 'drawers'
and 'dishwasher', whose flush faces intentionally run past the rail line to
the carcass top. The visible gap around a door is now the uniform reveal ring;
the 35mm rail reads as real painted wood (mirror of the buildIntegratedFridge
railBar from W2W-68). Verified by scene-geometry probe (front plane fully
covered 84.62→86 on T3) + close-up render at her camera angle. AND drawer
reveals matched to door weight (her follow-up same day, "looks bigger on
drawers"): the drawer geometry was right (2mm hairlines, SMALLER than the 3mm
door reveal) but flushRing's unlit-black ring at lw 0.11 on a lit flush face —
laid by BOTH adjacent faces across the shared gap (band = gap + lw ≈ 5mm of
flat black) — read far heavier than the recessed, shadow-softened door ring.
flatDrawer now passes lw 0.055 (band ≈ 3.4mm ≈ door weight); the flushRing
default stays 0.11 for the corner blank return. Tune the LOOK via that lw,
never the 2mm product gap.
→ 74 gate leads carry context (audit action #1, 2026-07-23): dxfgate.js
setLeadContext(fn) + recordLead merges the provider's {design_value, cabinets,
zip, mode} into the dxf_leads insert; main.js registers summarizeState-based
provider. Pairs with PLINTH/notify-triggers.sql (dxf_leads table with those
columns + pg_net triggers on orders/order_checks/trade_orders/dxf_leads/
contact_messages → notify-email edge fn) and the table-aware rewrite of
PLINTH/supabase-notify/notify-email.ts. Edge fn no-ops until RESEND_API_KEY
secret is set (Imogen must create the Resend account + paste the key herself).
→ 75 order confirmation + safe fallbacks (audit action #2, 2026-07-23): homeowner
"Place order" now mints a genOrderNo() ref (same PL-YYMM-XXXX series as trade),
passes it as orders.order_no (cloud.js submitOrder is schema-tolerant — retries
without the column if the ALTER hasn't run) AND prefixes it to order_text; on
success _showOrderSuccess() modal (#homeOrderModal, reuses .order-modal/.order-no-big)
shows the ref, cabinets·$, "Advisor emails your fixed quote to <email> within one
business day". EVERY bare location.href=mailto is gone (invisible no-op without a
mail app): dialog.js gains mailFallback({title,sub,to,subject,body,href}) — the
composed message in a readonly textarea + Copy button + "Open email app" anchor —
used by placeOrder's failure path, main.js order-check fallback, and trade.js
emailOrder. Customer confirmation EMAILS are deliberately deferred: Resend free
tier only delivers to the account owner until plinthmade.com is DNS-verified
(blocked on Namecheap access) — add to the edge fn when the domain verifies.
→ 76 concierge Order Advisor booking (audit action #3, her choice over Calendly/
HubSpot 2026-07-23): order-check modal gains "Best times to call" (ocTimes,
optional) + "reply within one business day" promise; call times ride in BOTH
order_checks.call_times (column ALTERed in; cloud.js schema-tolerant, folds
into note if column missing) AND the note field (the DEPLOYED notify-email
formatter prints note — the fn redeploy with the dedicated Call line + the
order_no subject is STILL PENDING, Edge Functions dashboard was down "Deploy
status unavailable"; local notify-email.ts has both). ?book=1 deep link opens
the modal on boot (skips wizard auto-open, hint consumed via replaceState;
ignored in trade mode). SITE: the three dead "Book a free Order Advisor call"
mentions (home 9 widget 21fd784, plinth-home 808 f03455b, FAQ 35 e770daa) are
now in-copy links to /planner/?book=1 (live-verified through the gate);
build-pages.py synced (homepage is live-widget-only per the drift rule).
→ 77 audit quick fixes (2026-07-23): (1) ui.js _setWorktop routes through
store.updateItem (first update records full pre-state = ONE undo step for the
run, rest quiet) — direct mutation meant countertop choices never autosaved and
undo couldn't see them; (2) trade.js u-beds/u-letter onChange now touchTrade()
before render. SAME DAY, SITE-SIDE (not in this repo): homepage stat →
"1 kitchen / to 400+ cabinets"; Developer/Multi-unit chip on /contact/;
newsletter forms on all 7 pages now report failure honestly (ok=r.ok pattern —
was fake success on error); gate snippet 747 gained a HubSpot email-capture
block ("No password? Keep me posted") + first-party fonts from
/planner/site-assets (source: website/redesign/wp-gate-brand-snippet.php).
WPCode LESSON reconfirmed the hard way: clicking Update after cm.setValue does
NOT reliably persist — cm.save() then form.requestSubmit(the form's real
submit control) is the only trustworthy path; verify via logged-out curl after
EVERY save.
Bump the BUILD string in `src/main.js` with every change set.

## Verification workflow that has worked

1. Write/extend pure tests first (sweeps across shapes × sizes × seeds).
2. `npm test` — 0 failures, always.
3. Visual check in a real browser (or headless: puppeteer with the system
   Chrome at /Applications/Google Chrome.app, `--no-sandbox
   --enable-unsafe-swiftshader`, drive the app via page.evaluate + dynamic
   import of core modules, screenshot, LOOK at it).
   `window.PlinthPlanner.loadState(json)` loads a hand-built state and
   rebuilds every layer — the hook for photographing exact fixtures;
   `PlinthPlanner.scene.captureImage(scale)` returns a PNG data URL.
   Serve with Cache-Control: no-store — plain python http.server lets the
   browser heuristically cache stale modules mid-iteration.
4. DXF changes: ezdxf recover audit (0 errors) + render front views to PNG.

## Backlog (client-aware, in rough priority)

- From the 2026-07-14 NYC-developer audit ("the rest"): per-phase progress
  billing (invoice engine currently 50/50 only), ADA/ANSI A117.1 accessible
  SKU variants, PO-number + remit-to + tax fields on invoices, site-measure
  partner integration (research done — see Sales_and_Pricing session notes),
  compliance certificate uploads.
- Per-instance site dimensions: measured walls per actual unit → per-instance
  fillers + out-of-tolerance exceptions rolled into orders.
- Logistics pack: container math per phase, packing lists, printable QR
  cabinet labels linking to the unit plan.
- Wizard: microwave question; measured-window input.
- Email notifications on status change (needs a Supabase edge function).
- Mobile polish pass for the trade tab.
