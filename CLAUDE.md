# fleet_app — Fleet Pulse (DOMECS exemplar #5)

Operations dashboard: external telemetry → coalesced projections over 400 vehicles
+ 100 infrastructure assets. ECS = DOMECS; DOM via `@domecs/dom` views.

## Layout

- `index.html` — static shell; slots `#map #table #stats #alarms #chart #detail #chrome`.
- `src/main.ts` — mounts DOMECS views (`pinView`, `rowView`), wires buttons/hotkeys,
  paints stats/chart/detail each `tickEnd`.
- `src/components.ts` — component definitions (Vehicle, Telemetry, TableRow, MapPin, …).
- `src/sim.ts` — world factory + projection systems (`rebuildTableRows`, etc.).
- `test/fleet.test.ts` — Vitest, ECS-level (no DOM).

## Run & test

```sh
npm run dev      # vite dev server — see port note below
npm test         # tsc --noEmit && vitest run
npm run build    # vite build
```

**Dev port note:** `npm run dev` is `vite --host 0.0.0.0` with no strict port. On a
machine running other localhost dev servers it can bind `0.0.0.0:<port>` while a
different service holds `127.0.0.1:<port>`, and `localhost` will silently serve the
WRONG app. When driving the app, pin an explicit free port and verify the page
`<title>` is `Fleet Pulse` before trusting it:

```sh
npx vite --host 127.0.0.1 --port 5199 --strictPort
curl -s localhost:5199/ | grep -i '<title>'   # expect: Fleet Pulse
```

## Manual / Playwright smoke process

This is the process used to validate a running build. Record app-level results in
this repo's `FINDINGS.md` (engine issues in `../domecs/doc/FINDINGS_fleet.md`) and
upsert Reqall issues (see below).

1. Start dev server on a verified free port; confirm `<title>` is `Fleet Pulse`.
2. `browser_navigate` to it; check `browser_console_messages` (favicon 404 is the
   only known-benign error).
3. Click **Inject 500 updates** → Pulse stats should coalesce: `wire updates`→500,
   `batches`→1, `projection runs` increments, alarm queue populates.
4. Click a fleet-table row → Drill-down shows vehicle detail.
5. Click **Sort speed** / **Sort battery** → rows reorder descending. **Assert the
   table holds exactly `tableWindowSize` (50) rows** — see known bug #2738.
6. Click **Rows ↑ / ↓** → window scrolls.
7. `npm test` + `tsc --noEmit` must pass.

## Known issues (Reqall project `HyperNovaSystem/fleet`)

- **#2738 (HIGH)** — ghost/duplicate table rows after sort/scroll. ECS state is
  correct (exactly 50 `TableRow`); root cause is an **`@domecs/dom` engine** bug
  (orphaned DOM nodes under same-tick remove-all/re-add) — recorded engine-side in
  `../domecs/FINDINGS.md` **O-16**. Fleet-side mitigation: update `TableRow` in
  place instead of remove-all/re-add in `sim.ts rebuildTableRows`. Tests are
  ECS-level and miss it.
- **#2739 (LOW, fleet-specific)** — chart bars show debug index labels;
  `/favicon.ico` 404; map pins overlap and intercept clicks; fragile dev port.

## Recording findings

Record every deficiency where the fault actually lives:

- **This app's own deficiencies** — bugs, missing features, UX/DX gaps in *this*
  codebase → **`FINDINGS.md`** at the root of this repo.
- **DOMECS engine deficiencies** — anything wrong with or missing from `@domecs/*`
  (API, DX, docs, performance, or an engine/renderer bug surfaced here) →
  **`../domecs/doc/FINDINGS_fleet.md`** in the engine repo. One file per app, so
  engine maintainers triage all app-surfaced findings together; the curated
  cross-app synthesis in `../domecs/FINDINGS.md` draws from these (e.g. the #2738
  ghost-row root cause is consolidated there as **O-16**).

When in doubt, fix-location decides: if the fix would land in `@domecs/*`, it is
an engine finding.

## Conventions (inherited)

- Red/green TDD; a task is not done until tests pass. Don't skip or commit failing
  tests. The #2738 fix should start with a failing DOM/integration test.
- Pull context from Reqall before a task; upsert Reqall records after.
- `git commit` after changes.
