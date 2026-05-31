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

### HIGH — Ghost/duplicate table rows after sort or scroll (Reqall #2738)

After **Inject 500 updates** then **Sort speed** (or **Rows ↓**), the fleet table
renders ~58 rows instead of 50: ~8 stale rows from the previous ordering are
prepended with their OLD rank indices (e.g. `3,4,17,18,27,28,41,42` —
BIKE-013/018/083/088/133/138/203/208) above a fresh, correctly-ranked 1..50 list.

**Root cause — DOM view, not the projection.**
`sim.ts` `rebuildTableRows()` (~L369-382) removes ALL `TableRow` components then
re-adds exactly `size` for the new window, and `DashboardStats.renderedTableRows`
reports 50 — ECS state is correct. The defect is in the DOM view layer:
`main.ts` `rowView = defineView({ slot:'table', query: Has(TableRow), ... })`.
Entities that drop OUT of the window have `TableRow` removed only (no re-add); the
view fails to delete their `<button class="row">` nodes for that remove-only case,
while entities retained across the rebuild coalesce remove+add and survive.

**Fix direction:** either `@domecs/dom` view exit/removal handling for a queried
component removed (esp. churned remove+add in one tick), or change the projection
to update `TableRow` in place instead of remove-all/re-add so the view never sees
a mass exit.

**Test gap:** the existing suite is ECS-level and passes; it never exercises DOM
reconciliation, so this regression is uncaught. Add a jsdom/Playwright test that
asserts exactly `tableWindowSize` row elements after a sort/scroll.

### LOW — cosmetic / usability (Reqall #2739)

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
