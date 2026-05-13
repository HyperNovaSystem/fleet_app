import { describe, expect, it } from 'vitest'
import { And, Has, Where } from '@domecs/core'
import {
  AlarmState,
  DashboardStats,
  Infrastructure,
  MapPin,
  TableRow,
  TableViewport,
  Telemetry,
  TelemetryBatchEvent,
  Vehicle,
  createFleetPulse,
  makeTelemetryBurst,
} from '../src/index.js'

describe('Fleet Pulse exemplar', () => {
  it('builds the dashboard entity mix from exemplar #5', () => {
    const refs = createFleetPulse({ seed: 1, headless: true })

    expect(refs.vehicleIds).toHaveLength(400)
    expect(refs.infrastructureIds).toHaveLength(100)
    expect(refs.world.query(Has(Vehicle)).size).toBe(400)
    expect(refs.world.query(Has(Infrastructure)).size).toBe(100)

    const stats = refs.world.getComponent(refs.dashboardId, DashboardStats)!
    expect(stats.totalVehicles).toBe(400)
    expect(stats.totalInfrastructure).toBe(100)
  })

  it('coalesces 500 external updates into one dashboard projection tick', () => {
    const refs = createFleetPulse({ seed: 2, headless: true })
    refs.world.emit(TelemetryBatchEvent, { updates: makeTelemetryBurst(refs, 500, { speed: 47 }) })
    refs.world.step(1 / 60)

    const stats = refs.world.getComponent(refs.dashboardId, DashboardStats)!
    expect(stats.wireUpdates).toBe(500)
    expect(stats.wireBatches).toBe(1)
    expect(stats.projectionRuns).toBe(1)
    expect(stats.lastBatchUpdates).toBe(500)
  })

  it('projects only the virtualized table window while map pins can cover the fleet', () => {
    const refs = createFleetPulse({ seed: 3, headless: true, tableWindowSize: 25 })
    refs.world.step(1 / 60)

    expect(refs.world.query(Has(TableRow)).size).toBe(25)
    expect(refs.world.query(Has(MapPin)).size).toBe(500)

    refs.setViewport({ offset: 40, sortBy: 'speed', sortDir: 'desc' })
    refs.world.step(1 / 60)
    const viewport = refs.world.getComponent(refs.dashboardId, TableViewport)!
    const stats = refs.world.getComponent(refs.dashboardId, DashboardStats)!
    expect(viewport.offset).toBe(40)
    expect(refs.visibleRows()).toHaveLength(25)
    expect(stats.renderedTableRows).toBe(25)
  })

  it('supports numeric range alarm queries over rapidly-changing telemetry values', () => {
    const refs = createFleetPulse({ seed: 4, headless: true, vehicleCount: 12, infrastructureCount: 0 })
    refs.world.emit(TelemetryBatchEvent, {
      updates: refs.vehicleIds.map((vehicleId, index) => ({
        vehicleId,
        seq: index + 1,
        lat: 40 + index * 0.01,
        lng: -74,
        speed: index < 5 ? 92 : 35,
        heading: 90,
        battery: index === 11 ? 8 : 80,
        fuel: 70,
        cargoTemp: 4,
        timestamp: index + 1,
      })),
    })
    refs.world.step(1 / 60)

    const speeding = refs.world.query(And(Has(Vehicle), Where(Telemetry, (t) => t.speed > 80)))
    const lowBattery = refs.world.query(And(Has(Vehicle), Where(Telemetry, (t) => t.battery < 15)))
    const stats = refs.world.getComponent(refs.dashboardId, DashboardStats)!

    expect(speeding.size).toBe(5)
    expect(lowBattery.size).toBe(1)
    expect(stats.activeAlarms).toBe(6)
    expect(refs.world.query(And(Has(Vehicle), Where(AlarmState, (a) => a.level === 'critical'))).size).toBeGreaterThan(0)
  })

  it('snapshots persistent fleet data but omits transient dashboard projections', () => {
    const refs = createFleetPulse({ seed: 5, headless: true, vehicleCount: 20, infrastructureCount: 5 })
    refs.world.step(1 / 60)

    const snapshot = refs.world.snapshot()
    const serialized = JSON.stringify(snapshot)
    expect(serialized).toContain('Vehicle')
    expect(serialized).toContain('Telemetry')
    expect(serialized).toContain('Infrastructure')
    const componentNames = new Set(snapshot.entities.flatMap((entity) => Object.keys(entity.components)))
    expect(componentNames.has('TableRow')).toBe(false)
    expect(componentNames.has('TableViewport')).toBe(false)
    expect(componentNames.has('MapPin')).toBe(false)
  })
})
