import type { VehicleRoadTopology } from '../../detection/domain/road-topology.js';
import type { DrivingRoute } from '../../routing/osrm-client.js';
import type { ScenarioRoute } from '../../routing/route-scenario.js';
import type { GeoPosition } from '../../vehicles/domain/vehicle.js';
import {
  createRoadNetwork,
  distanceMeters,
  getRoad,
  roadLengthMeters,
  type RoadNetwork,
  type RoadSegment,
} from './road-network.js';
import {
  advanceSimulation,
  createSimulation,
  type SimulationState,
  type VehiclePlan,
} from './simulation.js';

/**
 * Fixed scope for 10A: one ambulance and 25 simulated civilian cars.
 * A small pool of real OSRM route geometries is reused. No per-tick routing.
 */
export const TRAFFIC_CAR_COUNT = 25;
export const TRAFFIC_TEMPLATE_COUNT = 5;
export const DEFAULT_TRAFFIC_SEED = 2026;

export interface TrafficDriverProfile {
  readonly id: string;
  readonly cruiseSpeedMps: number;
  readonly phaseSeconds: number;
  readonly templateIndex: number;
}

export interface MixedTrafficScenario {
  readonly network: RoadNetwork;
  readonly initialSimulation: SimulationState;
  readonly routes: readonly ScenarioRoute[];
  /** Car node evidence is deliberately unavailable until Milestone 10B. */
  readonly topologies: readonly VehicleRoadTopology[];
  readonly profiles: readonly TrafficDriverProfile[];
  readonly seed: number;
}

function checkSeed(seed: number): void {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 4_294_967_295) {
    throw new RangeError('Traffic seed must be a 32-bit unsigned integer');
  }
}

/** Deterministic PRNG; do not use Math.random() for a replayable demo. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function validateRoute(route: DrivingRoute): void {
  if (
    !Number.isFinite(route.distanceMeters) ||
    route.distanceMeters <= 0 ||
    !Number.isFinite(route.durationSeconds) ||
    route.durationSeconds < 0 ||
    route.segmentIds.length === 0
  ) {
    throw new Error('Traffic route must have valid driving metadata and geometry');
  }

  for (const id of route.segmentIds) {
    getRoad(route.roadNetwork, id);
  }
}

/** Keep every remaining bend in a polyline after a sampled position. */
function roadTail(road: RoadSegment, progressMeters: number): GeoPosition[] {
  let covered = 0;
  for (let index = 1; index < road.points.length; index++) {
    const from = road.points[index - 1];
    const to = road.points[index];
    const length = distanceMeters(from, to);
    if (length === 0) continue;
    if (progressMeters <= covered + length) {
      const fraction = Math.max(0, Math.min(1, (progressMeters - covered) / length));
      return [
        {
          latitude: from.latitude + (to.latitude - from.latitude) * fraction,
          longitude: from.longitude + (to.longitude - from.longitude) * fraction,
        },
        ...road.points.slice(index).map((point) => ({ ...point })),
      ];
    }
    covered += length;
  }
  return [{ ...road.points[road.points.length - 1] }];
}

function remainingRoute(
  network: RoadNetwork,
  template: DrivingRoute,
  positionFraction: number,
  driverId: string,
): {
  readonly routeIds: string[];
  readonly startingPoint: GeoPosition;
  readonly extraRoad?: RoadSegment;
} {
  const roads = template.segmentIds.map((id) => getRoad(network, id));
  const distance = roads.reduce((total, road) => total + roadLengthMeters(road), 0);
  if (distance <= 1) {
    throw new Error('Traffic template is too short for vehicle placement');
  }

  let remaining = distance * positionFraction;
  let index = 0;
  while (index < roads.length - 1 && remaining >= roadLengthMeters(roads[index])) {
    remaining -= roadLengthMeters(roads[index]);
    index++;
  }

  let road = roads[index];
  const roadLength = roadLengthMeters(road);
  if (roadLength - remaining < 0.5) {
    if (index < roads.length - 1) {
      index++;
      road = roads[index];
    }
    // Never create a zero-length entry segment at a road endpoint.
    remaining = 0;
  }

  const routeIds = [...template.segmentIds.slice(index)];
  if (remaining < 0.5) {
    return {
      routeIds,
      startingPoint: { ...road.points[0] },
    };
  }

  const points = roadTail(road, remaining);
  if (points.length < 2 || distanceMeters(points[0], points[points.length - 1]) < 0.05) {
    throw new Error('Could not build a traversable traffic entry segment');
  }

  const extraRoad: RoadSegment = {
    id: `${driverId}:entry`,
    points,
  };

  return {
    routeIds: [extraRoad.id, ...template.segmentIds.slice(index + 1)],
    startingPoint: { ...points[0] },
    extraRoad,
  };
}

function summariseRoute(
  network: RoadNetwork,
  vehicleId: string,
  routeIds: readonly string[],
  speedMps: number,
): ScenarioRoute {
  const coordinates: [number, number][] = [];
  let distance = 0;
  for (const roadId of routeIds) {
    const road = getRoad(network, roadId);
    distance += roadLengthMeters(road);
    for (const [i, point] of road.points.entries()) {
      if (coordinates.length > 0 && i === 0) continue;
      coordinates.push([point.longitude, point.latitude]);
    }
  }
  return {
    vehicleId,
    distanceMeters: distance,
    durationSeconds: distance / speedMps,
    coordinates,
  };
}

/**
 * Build a replayable, bounded traffic scenario from six previously fetched
 * OSRM routes (one ambulance route and five civilian route templates).
 *
 * Cars start at varied positions on the routes, not all at the endpoints.
 * This is synthetic traffic, NOT a car-following or traffic-signal model.
 */
export function buildMixedTrafficScenario(
  ambulanceRoute: DrivingRoute,
  civilianTemplates: readonly DrivingRoute[],
  seed = DEFAULT_TRAFFIC_SEED,
): MixedTrafficScenario {
  checkSeed(seed);
  if (civilianTemplates.length !== TRAFFIC_TEMPLATE_COUNT) {
    throw new Error(`Traffic scenario requires ${TRAFFIC_TEMPLATE_COUNT} civilian route templates`);
  }

  const allRoutes = [ambulanceRoute, ...civilianTemplates];
  for (const route of allRoutes) validateRoute(route);

  const inputRoads = allRoutes.flatMap((route) => [...route.roadNetwork.values()]);
  if (inputRoads.length > 2_500) {
    throw new RangeError('Traffic route pool exceeds the 2500-segment demo limit');
  }

  // Ensures route IDs are disjoint (the OSRM client receives unique route IDs).
  const baseNetwork = createRoadNetwork(inputRoads);
  const random = seededRandom(seed);
  const plans: VehiclePlan[] = [
    {
      vehicle: {
        id: 'AMB-001',
        kind: 'EMERGENCY',
        position: { ...ambulanceRoute.snappedStart },
        speedMps: 15,
        headingDeg: 0,
        timestampMs: 0,
      },
      route: [...ambulanceRoute.segmentIds],
    },
  ];
  const extraRoads: RoadSegment[] = [];
  const profiles: TrafficDriverProfile[] = [];

  for (let index = 0; index < TRAFFIC_CAR_COUNT; index++) {
    const id = `CAR-${String(index + 1).padStart(3, '0')}`;
    const templateIndex = index % TRAFFIC_TEMPLATE_COUNT;
    const template = civilianTemplates[templateIndex];
    const positionSlot = Math.floor(index / TRAFFIC_TEMPLATE_COUNT);
    const fraction = Math.max(
      0.03,
      Math.min(0.87, 0.07 + (positionSlot + 0.45) * 0.153 + (random() - 0.5) * 0.045),
    );
    const cruiseSpeedMps = Math.round((6 + random() * 11) * 100) / 100;
    const phaseSeconds = Math.floor(random() * 19);

    const starting = remainingRoute(baseNetwork, template, fraction, id);
    if (starting.extraRoad) extraRoads.push(starting.extraRoad);

    profiles.push({ id, cruiseSpeedMps, phaseSeconds, templateIndex });
    plans.push({
      vehicle: {
        id,
        kind: 'CIVILIAN',
        position: starting.startingPoint,
        speedMps: cruiseSpeedMps,
        headingDeg: 0,
        timestampMs: 0,
      },
      route: starting.routeIds,
    });
  }

  const network = createRoadNetwork([...inputRoads, ...extraRoads]);
  const initialSimulation = createSimulation(network, 0, plans);
  const routes = plans.map((plan) =>
    summariseRoute(network, plan.vehicle.id, plan.route, plan.vehicle.speedMps),
  );

  // There is no trustworthy OSM-node-to-truncated-route mapping yet.
  // 10B will add per-car topology and alert validation; fail closed now.
  const topologies = plans.map((plan) => ({ vehicleId: plan.vehicle.id, nodes: [] }));

  return { network, initialSimulation, routes, topologies, profiles, seed };
}

/**
 * Deterministic stop/slow/cruise phases. Each advance is subdivided at whole
 * simulation seconds so a 5s step equals five consecutive 1s steps.
 */
export function advanceMixedTraffic(
  network: RoadNetwork,
  simulation: SimulationState,
  deltaMs: number,
  profiles: readonly TrafficDriverProfile[],
): SimulationState {
  if (!Number.isSafeInteger(deltaMs) || deltaMs < 0 || deltaMs > 60_000) {
    throw new RangeError('Traffic step must be an integer from 0 to 60000 milliseconds');
  }
  const speeds = new Map(profiles.map((profile) => [profile.id, profile]));
  let current = simulation;
  let remaining = deltaMs;

  while (remaining > 0) {
    const wholeSecond = Math.floor(current.timeMs / 1000);
    const untilBoundary = 1000 - (current.timeMs % 1000);
    const step = Math.min(remaining, untilBoundary);

    const adjusted: SimulationState = {
      timeMs: current.timeMs,
      vehicles: current.vehicles.map((entry) => {
        const profile = speeds.get(entry.vehicle.id);
        if (!profile || entry.finished) return entry;
        const cycle = (wholeSecond + profile.phaseSeconds) % 19;
        const multiplier = cycle < 2 ? 0 : cycle < 5 ? 0.35 : cycle < 8 ? 0.7 : 1;
        return {
          ...entry,
          vehicle: {
            ...entry.vehicle,
            speedMps: Math.round(profile.cruiseSpeedMps * multiplier * 100) / 100,
          },
        };
      }),
    };

    current = advanceSimulation(network, adjusted, step);
    remaining -= step;
  }
  return current;
}
