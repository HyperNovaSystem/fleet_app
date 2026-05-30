# Fleet Pulse

**▶ Live demo: https://hypernovasystem.github.io/fleet/**

DOMECS exemplar #5: an operations dashboard for a 400-vehicle fleet with a noisy WebSocket-style telemetry feed.

## Spec slice

- Build the default entity mix from `domecs/doc/exemplars.md` #5: 400 vehicles plus 100 infrastructure assets.
- Treat external telemetry events as the tick source. A WebSocket handler (or test) calls `world.emit(...)`; delivery happens on the next DOMECS tick.
- Coalesce feed bursts: hundreds of telemetry updates in one tick produce one dashboard projection/render pass, not one per wire update.
- Keep vehicle schema stable while component values change rapidly (`Telemetry`, `AlarmState`, `DashboardStats`).
- Support dashboard UI projections:
  - sortable/scrollable virtual table with only the visible row window projected;
  - map pins for fleet/infrastructure assets;
  - live chart samples and drill-down detail state.
- Support numeric-range filtering for alarms such as `speed > 80` and low battery.
- Make persistence optional: snapshots retain fleet data but omit transient dashboard projection state.

## Development

```sh
npm install
npm test
npm run dev
```
