import {
  And,
  Changed,
  Has,
  Or,
  Where,
  createWorld,
  defineEvent,
  entry,
  type World,
} from '@domecs/core'
import {
  AlarmState,
  ChartSeries,
  DashboardStats,
  FleetConfig,
  Infrastructure,
  MapPin,
  TableRow,
  TableViewport,
  Telemetry,
  Vehicle,
  type AlarmLevel,
  type SortDirection,
  type SortField,
  type TableFilter,
  type VehicleStatus,
  type VehicleType,
} from './components.js'

export interface ExternalTelemetry {
  vehicleId?: number
  vin?: string
  seq: number
  lat: number
  lng: number
  speed: number
  heading: number
  battery: number
  fuel: number
  cargoTemp: number
  timestamp: number
}

export const TelemetryEvent = defineEvent<ExternalTelemetry>('Telemetry')
export const TelemetryBatchEvent = defineEvent<{ updates: ExternalTelemetry[] }>('TelemetryBatch')
export const SetTableViewportEvent = defineEvent<Partial<ViewportPatch>>('SetTableViewport')
export const SelectVehicleEvent = defineEvent<{ vehicleId: number | null }>('SelectVehicle')
export const AcknowledgeAlarmEvent = defineEvent<{ vehicleId?: number }>('AcknowledgeAlarm')

export interface ViewportPatch {
  offset: number
  size: number
  sortBy: SortField
  sortDir: SortDirection
  filter: TableFilter
}

export interface FleetPulseOptions {
  seed?: number
  vehicleCount?: number
  infrastructureCount?: number
  tableWindowSize?: number
  speedLimit?: number
  lowBatteryThreshold?: number
  headless?: boolean
}

export interface FleetRowView {
  vehicleId: number
  rank: number
  callsign: string
  speed: number
  battery: number
  status: VehicleStatus
  alarmLevel: AlarmLevel
}

export interface FleetPulseRefs {
  world: World
  dashboardId: number
  vehicleIds: readonly number[]
  infrastructureIds: readonly number[]
  vehicleIdsByVin: ReadonlyMap<string, number>
  injectTelemetry(update: ExternalTelemetry): void
  injectBatch(updates: ExternalTelemetry[]): void
  flush(dt?: number): void
  setViewport(patch: Partial<ViewportPatch>): void
  selectVehicle(vehicleId: number | null): void
  visibleRows(): FleetRowView[]
}

const VEHICLE_TYPES: readonly VehicleType[] = ['van', 'truck', 'bike', 'service', 'responder']
const ROUTES = ['north loop', 'south loop', 'airport', 'port', 'hospital', 'warehouse', 'downtown'] as const

export function createFleetPulse(options: FleetPulseOptions = {}): FleetPulseRefs {
  const vehicleCount = options.vehicleCount ?? 400
  const infrastructureCount = options.infrastructureCount ?? 100
  const tableWindowSize = options.tableWindowSize ?? 50
  const speedLimit = options.speedLimit ?? 80
  const lowBatteryThreshold = options.lowBatteryThreshold ?? 15
  const world = createWorld({
    seed: options.seed ?? 0x51ee7,
    headless: options.headless ?? false,
    idle: true,
  })

  const dashboardId = world.spawn([
    entry(FleetConfig, FleetConfig.create({ speedLimit, lowBatteryThreshold, tableWindowSize })),
    entry(DashboardStats, DashboardStats.create({
      totalVehicles: vehicleCount,
      totalInfrastructure: infrastructureCount,
    })),
    entry(TableViewport, TableViewport.create({ size: tableWindowSize })),
    entry(ChartSeries, ChartSeries.create()),
  ])

  const vehicleIds: number[] = []
  const infrastructureIds: number[] = []
  const vehicleIdsByVin = new Map<string, number>()

  for (let i = 0; i < vehicleCount; i++) {
    const type = VEHICLE_TYPES[i % VEHICLE_TYPES.length] ?? 'van'
    const vin = `FP-${String(i + 1).padStart(4, '0')}`
    const id = world.spawn([
      entry(Vehicle, Vehicle.create({
        vin,
        callsign: `${type.toUpperCase()}-${String(i + 1).padStart(3, '0')}`,
        type,
        status: i % 19 === 0 ? 'charging' : i % 13 === 0 ? 'idle' : 'moving',
        route: ROUTES[i % ROUTES.length] ?? 'standby',
        driver: `driver-${String((i % 83) + 1).padStart(2, '0')}`,
      })),
      entry(Telemetry, Telemetry.create(seedTelemetry(i))),
      entry(AlarmState, AlarmState.create()),
    ])
    vehicleIds.push(id)
    vehicleIdsByVin.set(vin, id)
  }

  for (let i = 0; i < infrastructureCount; i++) {
    const kind = i % 4 === 0 ? 'depot' : i % 4 === 1 ? 'charger' : i % 4 === 2 ? 'warehouse' : 'service_hub'
    const id = world.spawn([
      entry(Infrastructure, Infrastructure.create({
        name: `${kind.replace('_', ' ')} ${i + 1}`,
        kind,
        lat: 39.62 + (i % 20) * 0.035,
        lng: -74.42 + Math.floor(i / 20) * 0.08,
        capacity: 40 + (i % 9) * 15,
        load: (i * 7) % 80,
      })),
    ])
    infrastructureIds.push(id)
  }

  installPins()
  rebuildProjection(false)

  world.system('ingest-telemetry', { schedule: 'event', triggers: [TelemetryEvent, TelemetryBatchEvent], priority: 10 }, (ctx) => {
    const singles = ctx.events.of(TelemetryEvent)
    const batches = ctx.events.of(TelemetryBatchEvent)
    const updates: ExternalTelemetry[] = []
    for (const event of singles) updates.push(event)
    for (const batch of batches) updates.push(...batch.updates)
    if (updates.length === 0) return

    const stats = mustStats()
    stats.wireUpdates += updates.length
    stats.wireBatches += singles.length + batches.length
    stats.lastBatchUpdates = updates.length
    world.markChanged(dashboardId, DashboardStats)

    for (const update of updates) ingestOne(update)
  })

  world.system('set-table-viewport', { schedule: 'event', triggers: [SetTableViewportEvent], priority: 20 }, (ctx) => {
    const last = ctx.events.of(SetTableViewportEvent).at(-1)
    if (!last) return
    applyViewportPatch(last)
  })

  world.system('select-vehicle', { schedule: 'event', triggers: [SelectVehicleEvent], priority: 20 }, (ctx) => {
    const last = ctx.events.of(SelectVehicleEvent).at(-1)
    if (!last) return
    selectVehicleNow(last.vehicleId)
  })

  world.system('acknowledge-alarms', { schedule: 'event', triggers: [AcknowledgeAlarmEvent], priority: 20 }, (ctx) => {
    const events = ctx.events.of(AcknowledgeAlarmEvent)
    if (events.length === 0) return
    for (const event of events) {
      const ids = event.vehicleId === undefined ? vehicleIds : [event.vehicleId]
      for (const id of ids) {
        const alarm = world.getComponent(id, AlarmState)
        if (!alarm || alarm.level === 'none') continue
        alarm.acknowledged = true
        world.markChanged(id, AlarmState)
      }
    }
  })

  world.system(
    'project-dashboard',
    { schedule: 'reactive', reactsTo: Or(Changed(Telemetry), Changed(TableViewport), Changed(AlarmState), Changed(DashboardStats)), priority: 100 },
    () => rebuildProjection(true),
  )

  function seedTelemetry(index: number): ReturnType<typeof Telemetry.create> {
    const speed = index % 13 === 0 ? 0 : 25 + ((index * 17) % 42)
    return Telemetry.create({
      seq: 0,
      lat: 39.82 + (index % 40) * 0.018,
      lng: -74.31 + Math.floor(index / 40) * 0.035,
      speed,
      heading: (index * 29) % 360,
      battery: 35 + ((index * 11) % 65),
      fuel: 30 + ((index * 7) % 70),
      cargoTemp: 2 + (index % 8) * 0.7,
      updatedAt: 0,
    })
  }

  function installPins(): void {
    for (const id of vehicleIds) {
      const telemetry = world.getComponent(id, Telemetry)
      const vehicle = world.getComponent(id, Vehicle)
      if (!telemetry || !vehicle) continue
      world.addComponent(id, MapPin, MapPin.create({
        kind: 'vehicle',
        label: vehicle.callsign,
        ...project(telemetry.lat, telemetry.lng),
      }))
    }
    for (const id of infrastructureIds) {
      const infra = world.getComponent(id, Infrastructure)
      if (!infra) continue
      world.addComponent(id, MapPin, MapPin.create({
        kind: 'infrastructure',
        label: infra.name,
        ...project(infra.lat, infra.lng),
      }))
    }
  }

  function ingestOne(update: ExternalTelemetry): void {
    const id = resolveVehicleId(update)
    if (id === null) return
    const telemetry = world.getComponent(id, Telemetry)
    if (!telemetry) return
    if (update.seq <= telemetry.seq) {
      const stats = mustStats()
      stats.staleUpdates += 1
      world.markChanged(dashboardId, DashboardStats)
      return
    }

    telemetry.seq = update.seq
    telemetry.lat = update.lat
    telemetry.lng = update.lng
    telemetry.speed = Math.max(0, update.speed)
    telemetry.heading = ((update.heading % 360) + 360) % 360
    telemetry.battery = Math.max(0, Math.min(100, update.battery))
    telemetry.fuel = Math.max(0, Math.min(100, update.fuel))
    telemetry.cargoTemp = update.cargoTemp
    telemetry.updatedAt = update.timestamp
    world.markChanged(id, Telemetry)

    const vehicle = world.getComponent(id, Vehicle)
    if (vehicle) {
      const nextStatus: VehicleStatus = telemetry.speed > 1 ? 'moving' : telemetry.battery < 99 ? 'charging' : 'idle'
      if (vehicle.status !== nextStatus) {
        vehicle.status = nextStatus
        world.markChanged(id, Vehicle)
      }
    }
    updateAlarm(id)
  }

  function updateAlarm(id: number): void {
    const telemetry = world.getComponent(id, Telemetry)
    const config = world.getComponent(dashboardId, FleetConfig)
    const alarm = world.getComponent(id, AlarmState)
    if (!telemetry || !config || !alarm) return

    let level: AlarmLevel = 'none'
    let code = ''
    let message = ''
    if (telemetry.battery < config.lowBatteryThreshold) {
      level = 'critical'
      code = 'LOW_BATTERY'
      message = `Battery ${Math.round(telemetry.battery)}%`
    } else if (telemetry.speed > config.speedLimit + 10) {
      level = 'critical'
      code = 'SPEED_CRITICAL'
      message = `${Math.round(telemetry.speed)} mph over control threshold`
    } else if (telemetry.speed > config.speedLimit) {
      level = 'warning'
      code = 'SPEEDING'
      message = `${Math.round(telemetry.speed)} mph`
    } else if (telemetry.fuel < 20) {
      level = 'warning'
      code = 'LOW_FUEL'
      message = `Fuel ${Math.round(telemetry.fuel)}%`
    } else if (telemetry.cargoTemp < -2 || telemetry.cargoTemp > 8) {
      level = 'warning'
      code = 'CARGO_TEMP'
      message = `Cargo ${telemetry.cargoTemp.toFixed(1)}°C`
    }

    if (alarm.level === level && alarm.code === code && alarm.message === message) return
    alarm.level = level
    alarm.code = code
    alarm.message = message
    alarm.acknowledged = false
    alarm.count += level === 'none' ? 0 : 1
    alarm.activeSince = level === 'none' ? 0 : telemetry.updatedAt
    world.markChanged(id, AlarmState)
  }

  function rebuildProjection(countRun: boolean): void {
    const stats = mustStats()
    const config = world.getComponent(dashboardId, FleetConfig)
    if (!config) return
    if (countRun) stats.projectionRuns += 1

    let moving = 0
    let offline = 0
    let speedSum = 0
    let activeAlarms = 0
    let criticalAlarms = 0
    let highSpeed = 0

    for (const id of vehicleIds) {
      const vehicle = world.getComponent(id, Vehicle)
      const telemetry = world.getComponent(id, Telemetry)
      const alarm = world.getComponent(id, AlarmState)
      const pin = world.getComponent(id, MapPin)
      if (!vehicle || !telemetry || !alarm) continue
      speedSum += telemetry.speed
      if (vehicle.status === 'moving') moving += 1
      if (vehicle.status === 'offline') offline += 1
      if (telemetry.speed > config.speedLimit) highSpeed += 1
      if (alarm.level !== 'none') activeAlarms += 1
      if (alarm.level === 'critical') criticalAlarms += 1
      if (pin) {
        const p = project(telemetry.lat, telemetry.lng)
        pin.x = p.x
        pin.y = p.y
        pin.label = vehicle.callsign
        pin.alarmLevel = alarm.level
        world.markChanged(id, MapPin)
      }
    }

    stats.activeAlarms = activeAlarms
    stats.criticalAlarms = criticalAlarms
    stats.highSpeedVehicles = highSpeed
    stats.averageSpeed = vehicleIds.length > 0 ? speedSum / vehicleIds.length : 0
    stats.movingVehicles = moving
    stats.offlineVehicles = offline

    rebuildTableRows()
    stats.renderedTableRows = world.query(Has(TableRow)).size
    stats.renderedMapPins = world.query(Has(MapPin)).size
    pushChartSample(stats)
    world.markChanged(dashboardId, DashboardStats)
  }

  function rebuildTableRows(): void {
    const rowIds = world.query(Has(TableRow)).entities.map((e) => e.id)
    for (const id of rowIds) world.removeComponent(id, TableRow)

    const viewport = world.getComponent(dashboardId, TableViewport)
    if (!viewport) return
    const ranked = sortedVehicleIds().slice(viewport.offset, viewport.offset + viewport.size)
    ranked.forEach((id, index) => {
      const vehicle = world.getComponent(id, Vehicle)
      const telemetry = world.getComponent(id, Telemetry)
      const alarm = world.getComponent(id, AlarmState)
      if (!vehicle || !telemetry || !alarm) return
      world.addComponent(id, TableRow, TableRow.create({
        rank: viewport.offset + index + 1,
        label: vehicle.callsign,
        speed: telemetry.speed,
        battery: telemetry.battery,
        status: vehicle.status,
        alarmLevel: alarm.level,
      }))
    })
  }

  function sortedVehicleIds(): number[] {
    const viewport = world.getComponent(dashboardId, TableViewport)
    const ids = vehicleIds.filter((id) => passesFilter(id, viewport?.filter ?? 'all'))
    ids.sort((a, b) => compareVehicles(a, b, viewport?.sortBy ?? 'callsign', viewport?.sortDir ?? 'asc'))
    return ids
  }

  function passesFilter(id: number, filter: TableFilter): boolean {
    if (filter === 'all') return true
    if (filter === 'alarms') return (world.getComponent(id, AlarmState)?.level ?? 'none') !== 'none'
    return world.getComponent(id, Vehicle)?.status === 'moving'
  }

  function compareVehicles(a: number, b: number, sortBy: SortField, dir: SortDirection): number {
    const mul = dir === 'desc' ? -1 : 1
    const av = sortValue(a, sortBy)
    const bv = sortValue(b, sortBy)
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul
    return String(av).localeCompare(String(bv)) * mul
  }

  function sortValue(id: number, sortBy: SortField): string | number {
    const vehicle = world.getComponent(id, Vehicle)
    const telemetry = world.getComponent(id, Telemetry)
    if (sortBy === 'callsign') return vehicle?.callsign ?? ''
    if (sortBy === 'status') return vehicle?.status ?? ''
    if (sortBy === 'speed') return telemetry?.speed ?? 0
    if (sortBy === 'battery') return telemetry?.battery ?? 0
    return telemetry?.updatedAt ?? 0
  }

  function pushChartSample(stats: ReturnType<typeof DashboardStats.create>): void {
    const chart = world.getComponent(dashboardId, ChartSeries)
    const config = world.getComponent(dashboardId, FleetConfig)
    if (!chart || !config) return
    chart.ticks.push(world.time.tick)
    chart.averageSpeed.push(round1(stats.averageSpeed))
    chart.activeAlarms.push(stats.activeAlarms)
    chart.wireUpdates.push(stats.wireUpdates)
    while (chart.ticks.length > config.chartSampleLimit) {
      chart.ticks.shift()
      chart.averageSpeed.shift()
      chart.activeAlarms.shift()
      chart.wireUpdates.shift()
    }
    world.markChanged(dashboardId, ChartSeries)
  }

  function resolveVehicleId(update: ExternalTelemetry): number | null {
    if (update.vehicleId !== undefined && world.has(update.vehicleId, Vehicle)) return update.vehicleId
    if (update.vin) return vehicleIdsByVin.get(update.vin) ?? null
    return null
  }

  function applyViewportPatch(patch: Partial<ViewportPatch>): void {
    const viewport = world.getComponent(dashboardId, TableViewport)
    if (!viewport) return
    if (patch.offset !== undefined) viewport.offset = Math.max(0, Math.min(vehicleIds.length, Math.floor(patch.offset)))
    if (patch.size !== undefined) viewport.size = Math.max(0, Math.floor(patch.size))
    if (patch.sortBy !== undefined) viewport.sortBy = patch.sortBy
    if (patch.sortDir !== undefined) viewport.sortDir = patch.sortDir
    if (patch.filter !== undefined) viewport.filter = patch.filter
    world.markChanged(dashboardId, TableViewport)
  }

  function selectVehicleNow(vehicleId: number | null): void {
    const stats = mustStats()
    stats.selectedVehicleId = vehicleId !== null && world.has(vehicleId, Vehicle) ? vehicleId : null
    world.markChanged(dashboardId, DashboardStats)
  }

  function mustStats(): ReturnType<typeof DashboardStats.create> {
    const stats = world.getComponent(dashboardId, DashboardStats)
    if (!stats) throw new Error('fleet_app: missing DashboardStats')
    return stats
  }

  const refs: FleetPulseRefs = {
    world,
    dashboardId,
    vehicleIds,
    infrastructureIds,
    vehicleIdsByVin,
    injectTelemetry(update) { world.emit(TelemetryEvent, update) },
    injectBatch(updates) { world.emit(TelemetryBatchEvent, { updates }) },
    flush(dt = 1 / 60) { world.step(dt) },
    setViewport(patch) { applyViewportPatch(patch) },
    selectVehicle(vehicleId) { selectVehicleNow(vehicleId) },
    visibleRows() {
      return world.query(Has(TableRow)).entities
        .map((e) => {
          const vehicle = world.getComponent(e.id, Vehicle)
          const row = world.getComponent(e.id, TableRow)
          if (!vehicle || !row) return null
          return {
            vehicleId: e.id,
            rank: row.rank,
            callsign: vehicle.callsign,
            speed: row.speed,
            battery: row.battery,
            status: row.status,
            alarmLevel: row.alarmLevel,
          }
        })
        .filter((row): row is FleetRowView => row !== null)
        .sort((a, b) => a.rank - b.rank)
    },
  }

  return refs
}

export function makeTelemetryBurst(
  refs: Pick<FleetPulseRefs, 'vehicleIds'>,
  count: number,
  patch: Partial<Omit<ExternalTelemetry, 'vehicleId' | 'seq' | 'timestamp'>> = {},
): ExternalTelemetry[] {
  const out: ExternalTelemetry[] = []
  if (refs.vehicleIds.length === 0) return out
  for (let i = 0; i < count; i++) {
    const vehicleId = refs.vehicleIds[i % refs.vehicleIds.length]
    if (vehicleId === undefined) continue
    out.push({
      vehicleId,
      seq: i + 1,
      lat: 39.8 + (i % 60) * 0.01,
      lng: -74.35 + Math.floor(i / 60) * 0.02,
      speed: 20 + (i % 70),
      heading: (i * 17) % 360,
      battery: 25 + (i % 75),
      fuel: 30 + (i % 70),
      cargoTemp: 4,
      timestamp: i + 1,
      ...patch,
    })
  }
  return out
}

export function highSpeedQuery(limit: number) {
  return And(Has(Vehicle), Where(Telemetry, (telemetry) => telemetry.speed > limit))
}

function project(lat: number, lng: number): { x: number; y: number } {
  return {
    x: Math.max(2, Math.min(98, 50 + (lng + 74.2) * 120)),
    y: Math.max(2, Math.min(98, 70 - (lat - 39.9) * 95)),
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
