/**
 * EV-RAS 11B: pure validation and evidence summary for real operator API data.
 * This module cannot generate alerts; it only audits ones returned by NestJS.
 */
import { createHash } from 'node:crypto';

export const DEMO_CAR_COUNT = 25;
export const DEMO_VEHICLE_COUNT = DEMO_CAR_COUNT + 1;
export const MANIFEST_VERSION = 1;

function fail(message) {
  throw new Error(`Demo audit: ${message}`);
}

export function validSeed(seed) {
  return Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff;
}

export function validateInitializedScene(data, requestedSeed) {
  if (!validSeed(requestedSeed)) fail('invalid seed');
  if (!data || data.active !== true || data.seed !== requestedSeed ||
      data.source !== 'OSRM' || data.encounterEvaluation !== 'TOPOLOGY_FILTERED' ||
      data.civilianCount !== DEMO_CAR_COUNT) {
    fail('traffic response does not describe the requested 25-car OSRM scenario');
  }
  const vehicles = data.snapshot?.vehicles;
  if (!Array.isArray(vehicles) || vehicles.length !== DEMO_VEHICLE_COUNT) {
    fail('expected 26 vehicles in initialization snapshot');
  }
  const ids = new Set(vehicles.map((vehicle) => vehicle.id));
  if (ids.size !== DEMO_VEHICLE_COUNT) fail('vehicle IDs are not unique');
  if (vehicles.filter((vehicle) => vehicle.id === 'AMB-001' && vehicle.kind === 'EMERGENCY').length !== 1) {
    fail('missing ambulance AMB-001');
  }
  for (let i = 1; i <= DEMO_CAR_COUNT; i++) {
    const id = `CAR-${String(i).padStart(3, '0')}`;
    if (!vehicles.some((vehicle) => vehicle.id === id && vehicle.kind === 'CIVILIAN')) {
      fail(`missing civilian ${id}`);
    }
  }
}

/** Route hash includes all 26 routed polylines and topology availability. */
export function routeFingerprint(metadata) {
  if (!metadata || metadata.source !== 'OSRM' || !Array.isArray(metadata.routes) ||
      metadata.routes.length !== DEMO_VEHICLE_COUNT) {
    fail('expected 26 OSRM route summaries');
  }
  const ids = new Set();
  const normalized = metadata.routes.map((route) => {
    if (typeof route?.vehicleId !== 'string' || ids.has(route.vehicleId) ||
        !Array.isArray(route.coordinates) || route.coordinates.length < 2 ||
        !Number.isFinite(route.distanceMeters) || route.distanceMeters <= 0 ||
        !Number.isFinite(route.durationSeconds) || route.durationSeconds < 0) {
      fail('invalid or duplicated route summary');
    }
    for (const coordinate of route.coordinates) {
      if (!Array.isArray(coordinate) || coordinate.length !== 2 ||
          !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) {
        fail('invalid route coordinate');
      }
    }
    ids.add(route.vehicleId);
    return [route.vehicleId, route.distanceMeters, route.durationSeconds, route.coordinates];
  });
  if (!ids.has('AMB-001') || ids.size !== DEMO_VEHICLE_COUNT) fail('route IDs incomplete');
  normalized.sort((a, b) => a[0].localeCompare(b[0]));
  return createHash('sha256').update(JSON.stringify({
    topologyStatus: metadata.topologyStatus ?? 'UNAVAILABLE',
    routes: normalized,
  })).digest('hex');
}

export function createAudit(seed, steps, geometryHash, topologyStatus) {
  if (!validSeed(seed) || !Number.isSafeInteger(steps) || steps < 1 || steps > 240 ||
      typeof geometryHash !== 'string' || !/^[a-f0-9]{64}$/.test(geometryHash)) {
    fail('invalid audit configuration');
  }
  const active = new Set();
  const created = new Set();
  const completed = new Set();
  const timeline = [];
  let checkedTicks = 0;
  let suppressedCandidates = 0;
  let supportedCandidates = 0;
  const totals = { CREATED: 0, UPDATED: 0, CLEARED: 0 };

  return {
    acceptTick(tick) {
      if (checkedTicks >= steps) fail('too many simulation ticks');
      const expectedTime = (checkedTicks + 1) * 1000;
      if (!tick || tick.timeMs !== expectedTime ||
          !Array.isArray(tick.snapshot?.vehicles) ||
          tick.snapshot.vehicles.length !== DEMO_VEHICLE_COUNT ||
          !Array.isArray(tick.events)) {
        fail(`invalid tick at ${expectedTime} ms`);
      }
      if (!Number.isSafeInteger(tick.suppressedCandidateCount) ||
          tick.suppressedCandidateCount < 0 ||
          !Number.isSafeInteger(tick.encounterCount) || tick.encounterCount < 0) {
        fail('encounter counters are missing or invalid');
      }
      suppressedCandidates += tick.suppressedCandidateCount;
      supportedCandidates += tick.encounterCount;
      const second = expectedTime / 1000;
      for (const event of tick.events) {
        const type = event?.type;
        const alert = event?.alert;
        const driverId = alert?.civilianVehicleId;
        if (!Object.hasOwn(totals, type) ||
            typeof driverId !== 'string' || !/^CAR-0(0[1-9]|1[0-9]|2[0-5])$/.test(driverId) ||
            (alert.emergencyVehicleId !== undefined && alert.emergencyVehicleId !== 'AMB-001')) {
          fail('unexpected or malformed alert event');
        }
        if (type === 'CREATED') {
          if (active.has(driverId)) fail(`duplicate CREATED for ${driverId}`);
          active.add(driverId);
          created.add(driverId);
        } else if (type === 'UPDATED') {
          if (!active.has(driverId)) fail(`UPDATED without CREATED for ${driverId}`);
        } else if (type === 'CLEARED') {
          if (!active.has(driverId)) fail(`CLEARED without CREATED for ${driverId}`);
          active.delete(driverId);
          completed.add(driverId);
        }
        totals[type]++;
        timeline.push({ second, type, driverId, reason: alert.reason ?? null });
      }
      if (Array.isArray(tick.snapshot.alerts)) {
        const serverIds = tick.snapshot.alerts.map((alert) => alert.civilianVehicleId);
        if (serverIds.length !== active.size ||
            serverIds.some((id) => !active.has(id))) {
          fail('active alerts disagree with operator snapshot');
        }
      }
      checkedTicks++;
    },
    finish() {
      if (checkedTicks !== steps) fail('incomplete simulation replay');
      const completedDrivers = [...completed].sort();
      return {
        version: MANIFEST_VERSION,
        source: 'OSRM',
        seed,
        steps,
        geometryHash,
        topologyStatus,
        vehicleCount: DEMO_VEHICLE_COUNT,
        totals: { ...totals },
        suppressedCandidates,
        supportedCandidates,
        warnedDrivers: [...created].sort(),
        completedDrivers,
        activeAtEnd: [...active].sort(),
        timeline,
        validated: completedDrivers.length > 0,
      };
    },
  };
}

export function scoreAudit(result) {
  // A created-and-cleared alert for one driver is mandatory for validation.
  return result.completedDrivers.length * 10_000 + result.totals.CREATED * 10 + result.warnedDrivers.length;
}

export function assertValidManifest(manifest) {
  if (!manifest || manifest.version !== MANIFEST_VERSION ||
      manifest.source !== 'OSRM' || !validSeed(manifest.seed) ||
      !Number.isSafeInteger(manifest.steps) || manifest.steps < 1 || manifest.steps > 240 ||
      typeof manifest.geometryHash !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.geometryHash) ||
      manifest.vehicleCount !== DEMO_VEHICLE_COUNT || manifest.validated !== true ||
      !Array.isArray(manifest.completedDrivers) || manifest.completedDrivers.length === 0 ||
      !Array.isArray(manifest.timeline) ||
      !manifest.totals || !Number.isSafeInteger(manifest.totals.CREATED) ||
      !Number.isSafeInteger(manifest.totals.CLEARED)) {
    fail('manifest is not a completed, validated 11B traffic run');
  }
  return manifest;
}

export function compareAudits(expected, actual) {
  assertValidManifest(expected);
  if (!actual.validated || expected.seed !== actual.seed || expected.steps !== actual.steps ||
      expected.geometryHash !== actual.geometryHash ||
      expected.topologyStatus !== actual.topologyStatus ||
      JSON.stringify(expected.timeline) !== JSON.stringify(actual.timeline) ||
      JSON.stringify(expected.totals) !== JSON.stringify(actual.totals) ||
      JSON.stringify(expected.completedDrivers) !== JSON.stringify(actual.completedDrivers) ||
      JSON.stringify(expected.activeAtEnd) !== JSON.stringify(actual.activeAtEnd)) {
    fail('replay differs from the saved road geometry or alert timeline');
  }
  return true;
}
