import { Has, type EntityView } from '@domecs/core'
import { defineView, mountDOM } from '@domecs/dom'
import { createInputPlugin } from '@domecs/input'
import {
  AlarmState,
  ChartSeries,
  DashboardStats,
  Infrastructure,
  MapPin,
  SetTableViewportEvent,
  TableRow,
  TableViewport,
  Telemetry,
  Vehicle,
  createFleetPulse,
  makeTelemetryBurst,
} from './index.js'
import './style.css'

const map = must('map')
const table = must('table')
const statsEl = must('stats')
const alarmsEl = must('alarms')
const chartEl = must('chart')
const detailEl = must('detail')
const chrome = must('chrome')
const burstButton = must('burst') as HTMLButtonElement

const refs = createFleetPulse({})
const { world } = refs
world.use(createInputPlugin({ preventDefaultKeys: true }))

const pinView = defineView({
  slot: 'map',
  query: Has(MapPin),
  changedOn: [MapPin, Telemetry, AlarmState],
  create(e) {
    const el = document.createElement('button')
    el.className = 'pin'
    el.addEventListener('click', () => {
      if (world.has(e.id, Vehicle)) refs.selectVehicle(e.id)
    })
    paintPin(el, e)
    return el
  },
  update(el, e) { paintPin(el as HTMLButtonElement, e) },
})

const rowView = defineView({
  slot: 'table',
  query: Has(TableRow),
  changedOn: [TableRow, Telemetry, AlarmState, Vehicle],
  create(e) {
    const el = document.createElement('button')
    el.className = 'row'
    el.addEventListener('click', () => refs.selectVehicle(e.id))
    paintRow(el, e)
    return el
  },
  update(el, e) { paintRow(el as HTMLButtonElement, e) },
})

mountDOM(world, { slots: { map, table }, views: [pinView, rowView] })

burstButton.addEventListener('click', () => {
  refs.injectBatch(makeTelemetryBurst(refs, 500))
})

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sort]')) {
  button.addEventListener('click', () => {
    const sortBy = button.dataset.sort === 'battery' ? 'battery' : 'speed'
    world.emit(SetTableViewportEvent, { sortBy, sortDir: 'desc' })
  })
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-scroll]')) {
  button.addEventListener('click', () => {
    const viewport = world.getComponent(refs.dashboardId, TableViewport)
    const delta = Number(button.dataset.scroll ?? 0)
    world.emit(SetTableViewportEvent, { offset: Math.max(0, (viewport?.offset ?? 0) + delta) })
  })
}

world.system('browser-hotkeys', { schedule: 'tick' }, () => {
  if (world.input.keyDelta.pressed.has('KeyB')) refs.injectBatch(makeTelemetryBurst(refs, 500))
  if (world.input.keyDelta.pressed.has('Digit1')) world.emit(SetTableViewportEvent, { sortBy: 'callsign', sortDir: 'asc' })
  if (world.input.keyDelta.pressed.has('Digit2')) world.emit(SetTableViewportEvent, { sortBy: 'speed', sortDir: 'desc' })
  if (world.input.keyDelta.pressed.has('Digit3')) world.emit(SetTableViewportEvent, { filter: 'alarms' })
})

world.signals.tickEnd.subscribe(() => {
  paintStats()
  paintChart()
  paintDetail()
  paintChrome()
})

world.step(0)
paintStats()
paintChart()
paintDetail()
paintChrome()
world.start({ dtClampMs: 100 })

function paintPin(el: HTMLButtonElement, e: EntityView): void {
  const pin = world.getComponent(e.id, MapPin)
  if (!pin) return
  el.className = `pin ${pin.kind} ${pin.alarmLevel}`
  el.textContent = pin.kind === 'vehicle' ? '●' : '◆'
  el.title = describePin(e.id)
  el.style.left = `${pin.x}%`
  el.style.top = `${pin.y}%`
}

function paintRow(el: HTMLButtonElement, e: EntityView): void {
  const row = world.getComponent(e.id, TableRow)
  if (!row) return
  el.className = `row ${row.alarmLevel}`
  el.innerHTML = `<span>${row.rank}</span><strong>${row.label}</strong><span>${Math.round(row.speed)} mph</span><span>${Math.round(row.battery)}%</span><em>${row.status}</em>`
}

function paintStats(): void {
  const stats = world.getComponent(refs.dashboardId, DashboardStats)
  if (!stats) return
  statsEl.innerHTML = `
    ${stat('vehicles', stats.totalVehicles)}
    ${stat('infra', stats.totalInfrastructure)}
    ${stat('wire updates', stats.wireUpdates.toLocaleString())}
    ${stat('batches', stats.wireBatches)}
    ${stat('projection runs', stats.projectionRuns)}
    ${stat('avg speed', `${stats.averageSpeed.toFixed(1)} mph`)}
    ${stat('moving', stats.movingVehicles)}
    ${stat('alarms', stats.activeAlarms)}
    ${stat('critical', stats.criticalAlarms)}
    ${stat('table rows', stats.renderedTableRows)}
    ${stat('map pins', stats.renderedMapPins)}
  `
  const alarms = refs.vehicleIds
    .map((id) => ({ id, vehicle: world.getComponent(id, Vehicle), alarm: world.getComponent(id, AlarmState) }))
    .filter((x) => x.alarm && x.alarm.level !== 'none')
    .slice(0, 7)
  alarmsEl.innerHTML = `<h3>Alarm queue</h3>${alarms.map((x) => `<p class="alarm ${x.alarm!.level}"><strong>${x.vehicle?.callsign}</strong> ${x.alarm!.message}</p>`).join('') || '<p>No active alarms.</p>'}`
}

function paintChart(): void {
  const chart = world.getComponent(refs.dashboardId, ChartSeries)
  if (!chart || chart.ticks.length === 0) {
    chartEl.innerHTML = '<p>Awaiting telemetry…</p>'
    return
  }
  const maxUpdates = Math.max(1, ...chart.wireUpdates)
  chartEl.innerHTML = chart.wireUpdates.slice(-48).map((n, i) => {
    const h = Math.max(4, (n / maxUpdates) * 100)
    return `<span title="wire updates ${n}" style="height:${h}%">${i}</span>`
  }).join('')
}

function paintDetail(): void {
  const stats = world.getComponent(refs.dashboardId, DashboardStats)
  const id = stats?.selectedVehicleId
  if (id === null || id === undefined) {
    detailEl.innerHTML = '<h3>Drill-down</h3><p>Select a row or map pin.</p>'
    return
  }
  const vehicle = world.getComponent(id, Vehicle)
  const telemetry = world.getComponent(id, Telemetry)
  const alarm = world.getComponent(id, AlarmState)
  detailEl.innerHTML = `<h3>${vehicle?.callsign ?? 'Vehicle'}</h3>
    <p>${vehicle?.route ?? ''} · ${vehicle?.driver ?? ''}</p>
    <ul>
      <li>Speed: ${Math.round(telemetry?.speed ?? 0)} mph</li>
      <li>Battery: ${Math.round(telemetry?.battery ?? 0)}%</li>
      <li>Fuel: ${Math.round(telemetry?.fuel ?? 0)}%</li>
      <li>Alarm: ${alarm?.level ?? 'none'} ${alarm?.message ?? ''}</li>
    </ul>`
}

function paintChrome(): void {
  chrome.textContent = `tick ${world.time.tick} · ${refs.visibleRows().length} virtual rows · external events wake idle world`
}

function describePin(id: number): string {
  const vehicle = world.getComponent(id, Vehicle)
  if (vehicle) {
    const telemetry = world.getComponent(id, Telemetry)
    const alarm = world.getComponent(id, AlarmState)
    return `${vehicle.callsign}: ${Math.round(telemetry?.speed ?? 0)} mph, ${Math.round(telemetry?.battery ?? 0)}%, ${alarm?.level ?? 'none'}`
  }
  const infra = world.getComponent(id, Infrastructure)
  return infra ? `${infra.name}: ${infra.load}/${infra.capacity}` : ''
}

function stat(k: string, v: string | number): string {
  return `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing #${id}`)
  return el
}
