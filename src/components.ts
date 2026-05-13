import { defineComponent } from '@domecs/core'

export type VehicleType = 'van' | 'truck' | 'bike' | 'service' | 'responder'
export type VehicleStatus = 'moving' | 'idle' | 'charging' | 'maintenance' | 'offline'
export type AlarmLevel = 'none' | 'info' | 'warning' | 'critical'
export type InfrastructureKind = 'depot' | 'charger' | 'warehouse' | 'service_hub'
export type SortField = 'callsign' | 'speed' | 'battery' | 'status' | 'updatedAt'
export type SortDirection = 'asc' | 'desc'
export type TableFilter = 'all' | 'alarms' | 'moving'
export type PinKind = 'vehicle' | 'infrastructure'

function finite(name: string, value: number): true | string {
  return Number.isFinite(value) ? true : `${name} must be finite`
}

function nonNegativeInteger(name: string, value: number): true | string {
  return Number.isInteger(value) && value >= 0 ? true : `${name} must be a non-negative integer`
}

function bounded(name: string, value: number, min: number, max: number): true | string {
  if (!Number.isFinite(value) || value < min || value > max) return `${name} must be between ${min} and ${max}`
  return true
}

export const FleetConfig = defineComponent<{
  title: string
  speedLimit: number
  lowBatteryThreshold: number
  tableWindowSize: number
  chartSampleLimit: number
}>('FleetConfig', {
  defaults: {
    title: 'Fleet Pulse',
    speedLimit: 80,
    lowBatteryThreshold: 15,
    tableWindowSize: 50,
    chartSampleLimit: 120,
  },
  validate: (value) => {
    const speed = finite('speedLimit', value.speedLimit)
    if (speed !== true) return speed
    const battery = bounded('lowBatteryThreshold', value.lowBatteryThreshold, 0, 100)
    if (battery !== true) return battery
    const rows = nonNegativeInteger('tableWindowSize', value.tableWindowSize)
    if (rows !== true) return rows
    return nonNegativeInteger('chartSampleLimit', value.chartSampleLimit)
  },
})

export const DashboardStats = defineComponent<{
  totalVehicles: number
  totalInfrastructure: number
  wireUpdates: number
  wireBatches: number
  staleUpdates: number
  lastBatchUpdates: number
  projectionRuns: number
  activeAlarms: number
  criticalAlarms: number
  highSpeedVehicles: number
  averageSpeed: number
  movingVehicles: number
  offlineVehicles: number
  renderedTableRows: number
  renderedMapPins: number
  selectedVehicleId: number | null
}>('DashboardStats', {
  defaults: {
    totalVehicles: 0,
    totalInfrastructure: 0,
    wireUpdates: 0,
    wireBatches: 0,
    staleUpdates: 0,
    lastBatchUpdates: 0,
    projectionRuns: 0,
    activeAlarms: 0,
    criticalAlarms: 0,
    highSpeedVehicles: 0,
    averageSpeed: 0,
    movingVehicles: 0,
    offlineVehicles: 0,
    renderedTableRows: 0,
    renderedMapPins: 0,
    selectedVehicleId: null,
  },
})

export const Vehicle = defineComponent<{
  vin: string
  callsign: string
  type: VehicleType
  status: VehicleStatus
  route: string
  driver: string
}>('Vehicle', {
  defaults: {
    vin: '',
    callsign: '',
    type: 'van',
    status: 'idle',
    route: 'standby',
    driver: 'unassigned',
  },
})

export const Telemetry = defineComponent<{
  seq: number
  lat: number
  lng: number
  speed: number
  heading: number
  battery: number
  fuel: number
  cargoTemp: number
  updatedAt: number
}>('Telemetry', {
  defaults: {
    seq: 0,
    lat: 40,
    lng: -74,
    speed: 0,
    heading: 0,
    battery: 100,
    fuel: 100,
    cargoTemp: 4,
    updatedAt: 0,
  },
  validate: (value) => {
    const seq = nonNegativeInteger('seq', value.seq)
    if (seq !== true) return seq
    for (const key of ['lat', 'lng', 'speed', 'heading', 'battery', 'fuel', 'cargoTemp', 'updatedAt'] as const) {
      const verdict = finite(key, value[key])
      if (verdict !== true) return verdict
    }
    return true
  },
})

export const AlarmState = defineComponent<{
  level: AlarmLevel
  code: string
  message: string
  acknowledged: boolean
  activeSince: number
  count: number
}>('AlarmState', {
  defaults: {
    level: 'none',
    code: '',
    message: '',
    acknowledged: false,
    activeSince: 0,
    count: 0,
  },
})

export const Infrastructure = defineComponent<{
  name: string
  kind: InfrastructureKind
  lat: number
  lng: number
  capacity: number
  load: number
}>('Infrastructure', {
  defaults: {
    name: '',
    kind: 'depot',
    lat: 40,
    lng: -74,
    capacity: 100,
    load: 0,
  },
  validate: (value) => {
    for (const key of ['lat', 'lng', 'capacity', 'load'] as const) {
      const verdict = finite(key, value[key])
      if (verdict !== true) return verdict
    }
    return true
  },
})

export const TableViewport = defineComponent<{
  offset: number
  size: number
  sortBy: SortField
  sortDir: SortDirection
  filter: TableFilter
}>('TableViewport', {
  defaults: { offset: 0, size: 50, sortBy: 'callsign', sortDir: 'asc', filter: 'all' },
  transient: true,
  validate: (value) => {
    const offset = nonNegativeInteger('offset', value.offset)
    if (offset !== true) return offset
    return nonNegativeInteger('size', value.size)
  },
})

export const TableRow = defineComponent<{
  rank: number
  label: string
  speed: number
  battery: number
  status: VehicleStatus
  alarmLevel: AlarmLevel
}>('TableRow', {
  defaults: { rank: 0, label: '', speed: 0, battery: 100, status: 'idle', alarmLevel: 'none' },
  transient: true,
})

export const MapPin = defineComponent<{
  kind: PinKind
  label: string
  x: number
  y: number
  alarmLevel: AlarmLevel
}>('MapPin', {
  defaults: { kind: 'vehicle', label: '', x: 0, y: 0, alarmLevel: 'none' },
  transient: true,
})

export const ChartSeries = defineComponent<{
  ticks: number[]
  averageSpeed: number[]
  activeAlarms: number[]
  wireUpdates: number[]
}>('ChartSeries', {
  defaults: { ticks: [], averageSpeed: [], activeAlarms: [], wireUpdates: [] },
  transient: true,
})
