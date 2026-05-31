# Fleet Pulse — Playwright Findings

Date: 2026-05-31 · Build: `0.1.0-alpha.0` · DOMECS exemplar #5

Findings from running the app (`vite` dev server) and driving it with Playwright.
Tracked in Reqall (project `HyperNovaSystem/fleet`): issues **#2738** (high), **#2739** (low).

## Verified working

- Initial render of header, Pulse panel, map, chart, fleet table.
- **Inject 500 updates** coalesces correctly: `wireUpdates` 0→500, `wireBatches`→1,
  `projectionRuns`→2, `avg speed` recomputes, alarm queue populates.
- Row-click drill-down (shows callsign, route, driver, speed, battery, fuel, alarm).
- **Sort speed** / **Sort battery** reorder descending.
- Row scroll (**Rows ↑ / ↓**).
- `npm test` → 5/5 pass; `tsc --noEmit` clean.

## Deficiencies

> **Scope split.** The ghost-row defect roots in the `@domecs/dom` engine, not in
> fleet_app — it is recorded in the engine findings:
> `../domecs/FINDINGS.md` → **O-16** (sharpens O-5/O-6). Below is only the
> fleet-side trigger + mitigation. Everything else here is fleet-specific.

### HIGH — Ghost/duplicate table rows after sort or scroll (Reqall #2738) — MITIGATED

**Status:** Fixed fleet-side 2026-05-31 (in-place `TableRow` update). Engine root
cause O-16 remains open in `../domecs/`.

**Symptom (fleet):** after **Inject 500 updates** then **Sort speed** (or
**Rows ↓**), the fleet table retained ~8 stale rows from the previous ordering,
carrying their OLD rank indices (e.g. `3,4,17,18,27,28,41,42` —
BIKE-013/018/083/088/133/138/203/208) — visible as duplicate ranks in the rendered
1..50 list, while ECS state was correct (`DashboardStats.renderedTableRows` = 50).

**This is an engine bug, surfaced by a fleet pattern.** `sim.ts`
`rebuildTableRows()` previously removed ALL `TableRow` components then re-added
exactly `size` for the new window. The orphaned DOM nodes come from `@domecs/dom`
view reconciliation under a same-tick remove-all/re-add churn — see
`../domecs/doc/FINDINGS_fleet.md` / `../domecs/FINDINGS.md` O-16 for the engine
root-cause analysis. The defect is render-scheduling sensitive: it surfaces under
the rAF `startLoop`, and reproduces deterministically in jsdom when the rendered
ranks (not just the row count) are inspected.

**Fleet-side mitigation (landed):** `rebuildTableRows()` now updates `TableRow`
**in place** keyed by entity — only entities leaving the window are removed and
only entities entering are added, so the view never sees a mass component exit.
`rowView` is unchanged.

**Regression test:** `test/fleet.dom.test.ts` (jsdom) mounts the real `rowView`
(+`pinView`) via `mountDOM`, runs inject→sort and inject→sort→scroll, and asserts
the rendered table shows exactly `tableWindowSize` rows ranked `1..N` with no
duplicate/ghost ranks. It failed before the fix (`[1,2,3,3,4,4,…]`) and passes
after. The original ECS-level suite never painted the slot, so it missed this.

### LOW — cosmetic / usability (Reqall #2739, all fleet-specific)

1. **Chart debug labels.** `paintChart()` (`main.ts` ~L157) renders each bar as
   `<span ...>${i}</span>`, printing the index `0,1,2,…` as visible text in every
   bar. Debug leftover — text content should be empty.
2. **Favicon 404.** `index.html` declares no favicon; every load logs
   `404 @ /favicon.ico`. Add an icon or link.
3. **Overlapping map pins.** 500 absolutely-positioned pins in `#map` overlap;
   pointer events are intercepted (e.g. RESPONDER-400 covers VAN-001), so most
   pins can't be clicked to drive drill-down. Row-click drill-down works.
4. **Fragile dev port.** `npm run dev` runs `vite --host 0.0.0.0` with no
   fixed/strict port. With another localhost dev server present, fleet bound
   `0.0.0.0:5173` while a pre-existing service held `127.0.0.1:5173`, so
   `localhost` silently served the WRONG app with no error. Prefer a
   project-specific port + `strictPort: true`.
