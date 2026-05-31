// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Has } from '@domecs/core'
import { defineView, mountDOM } from '@domecs/dom'
import {
  AlarmState,
  MapPin,
  SetTableViewportEvent,
  TableRow,
  Telemetry,
  Vehicle,
  createFleetPulse,
  makeTelemetryBurst,
} from '../src/index.js'
import type { FleetPulseRefs } from '../src/index.js'

// DOM/integration coverage for Reqall #2738 (engine root cause domecs O-16):
// after a sort, the ECS holds exactly `tableWindowSize` TableRow, but the
// rendered table can retain stale ghost rows carrying their PRE-sort rank.
// The existing suite is ECS-level and never paints the slot, so it misses this.
// Mirrors the two views wired in src/main.ts so the engine sees the same churn.
function mountFaithful(refs: FleetPulseRefs): HTMLElement {
  const map = document.createElement('div')
  const table = document.createElement('div')
  document.body.append(map, table)

  const paintRow = (el: HTMLElement, id: number) => {
    const row = refs.world.getComponent(id, TableRow)
    if (!row) return
    el.dataset.rank = String(row.rank)
    el.textContent = `${row.rank} ${row.label}`
  }

  const pinView = defineView({
    slot: 'map',
    query: Has(MapPin),
    changedOn: { mode: 'explicit', types: [MapPin, Telemetry, AlarmState] },
    create() {
      const el = document.createElement('button')
      el.className = 'pin'
      return el
    },
    update() {},
  })

  const rowView = defineView({
    slot: 'table',
    query: Has(TableRow),
    changedOn: { mode: 'explicit', types: [TableRow, Telemetry, AlarmState, Vehicle] },
    create(e) {
      const el = document.createElement('button')
      el.className = 'row'
      paintRow(el, e.id)
      return el
    },
    update(el, e) { paintRow(el as HTMLElement, e.id) },
  })

  const mounted = mountDOM(refs.world, { slots: { map, table }, views: [pinView, rowView] })
  if (!mounted.ok) throw new Error(`mountDOM failed (${mounted.error.kind})`)
  return table
}

describe('Fleet table DOM reconciliation (#2738)', () => {
  let refs: FleetPulseRefs
  let table: HTMLElement

  beforeEach(() => {
    refs = createFleetPulse({ seed: 7, tableWindowSize: 50 })
    table = mountFaithful(refs)
    refs.world.step(1 / 60)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  const renderedRanks = () =>
    [...table.querySelectorAll<HTMLElement>('.row')].map((el) => Number(el.dataset.rank))

  it('shows exactly tableWindowSize rows ranked 1..N with no ghosts after a sort', () => {
    refs.injectBatch(makeTelemetryBurst(refs, 500))
    refs.world.step(1 / 60)

    refs.world.emit(SetTableViewportEvent, { sortBy: 'speed', sortDir: 'desc' })
    refs.world.step(1 / 60)

    const ranks = renderedRanks()
    expect(ranks).toHaveLength(50)
    expect([...ranks].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    )
  })

  it('shows exactly tableWindowSize rows ranked 1..N with no ghosts after a scroll', () => {
    refs.injectBatch(makeTelemetryBurst(refs, 500))
    refs.world.step(1 / 60)

    refs.world.emit(SetTableViewportEvent, { sortBy: 'speed', sortDir: 'desc' })
    refs.world.step(1 / 60)
    refs.world.emit(SetTableViewportEvent, { offset: 25 })
    refs.world.step(1 / 60)

    const ranks = renderedRanks()
    expect(ranks).toHaveLength(50)
    expect(new Set(ranks).size).toBe(50)
  })
})
