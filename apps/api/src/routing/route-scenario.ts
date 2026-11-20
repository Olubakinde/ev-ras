import type {
  VehicleRoadTopology,
} from '../detection/domain/road-topology.js';

import {
  createRoadNetwork,
  type RoadNetwork,
  type RoadSegment,
} from '../simulation/domain/road-network.js';

import {
  createSimulation,
  type SimulationState,
  type VehiclePlan,
} from '../simulation/domain/simulation.js';

import type { VehicleKind } from '../vehicles/domain/vehicle.js';
import type { DrivingRoute } from './osrm-client.js';

export interface RoutedVehicle {
  readonly id: string;
  readonly kind: VehicleKind;
  readonly speedMps: number;
  readonly route: DrivingRoute;
}

export interface ScenarioRoute {
  readonly vehicleId: string;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly coordinates: readonly (readonly [number, number])[];
}

export interface RoadScenario {
  readonly network: RoadNetwork;
  readonly simulation: SimulationState;
  readonly routes: readonly ScenarioRoute[];
  readonly topologies: readonly VehicleRoadTopology[];
}

const MAX_VEHICLES = 3;
const MAX_TOTAL_SEGMENTS = 1_500;
const MAX_ROUTE_DISTANCE_M = 25_000;

function validateRoute(route: DrivingRoute): void {
  if (
    !Number.isFinite(route.distanceMeters) ||
    route.distanceMeters <= 0 ||
    route.distanceMeters > MAX_ROUTE_DISTANCE_M
  ) {
    throw new RangeError('Driving route distance is outside demo limits');
  }

  if (!Number.isFinite(route.durationSeconds) || route.durationSeconds < 0) {
    throw new RangeError('Invalid driving route duration');
  }

  if (route.segmentIds.length === 0 || route.coordinates.length < 2) {
    throw new Error('Driving route must contain road geometry');
  }

  for (const [longitude, latitude] of route.coordinates) {
    if (
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180 ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90
    ) {
      throw new RangeError('Invalid driving route coordinates');
    }
  }
}

/** Combines directed driving routes into a single shared simulation. */
export function buildRoadScenario(
  vehicles: readonly RoutedVehicle[],
  startTimeMs = 0,
): RoadScenario {
  if (vehicles.length < 2 || vehicles.length > MAX_VEHICLES) {
    throw new RangeError('A road scenario needs 2 or 3 vehicles');
  }

  const emergencies = vehicles.filter((entry) => entry.kind === 'EMERGENCY');
  const civilians = vehicles.filter((entry) => entry.kind === 'CIVILIAN');

  if (emergencies.length !== 1 || civilians.length < 1) {
    throw new Error(
      'Scenario requires one emergency vehicle and at least one civilian',
    );
  }

  const ids = new Set<string>();
  const roads: RoadSegment[] = [];
  const plans: VehiclePlan[] = [];
  const summaries: ScenarioRoute[] = [];
  const topologies: VehicleRoadTopology[] = [];

  for (const entry of vehicles) {
    if (typeof entry.id !== 'string' || !entry.id.trim()) {
      throw new Error('Scenario vehicle ID cannot be empty');
    }

    if (ids.has(entry.id)) {
      throw new Error(`Duplicate scenario vehicle: ${entry.id}`);
    }
    ids.add(entry.id);

    if (!Number.isFinite(entry.speedMps) || entry.speedMps < 0) {
      throw new RangeError(`Invalid speed for vehicle ${entry.id}`);
    }

    validateRoute(entry.route);

    for (const segment of entry.route.roadNetwork.values()) {
      roads.push(segment);
    }

    plans.push({
      vehicle: {
        id: entry.id,
        kind: entry.kind,
        position: { ...entry.route.snappedStart },
        speedMps: entry.speedMps,
        headingDeg: 0,
        timestampMs: startTimeMs,
      },
      route: [...entry.route.segmentIds],
    });

    summaries.push({
      vehicleId: entry.id,
      distanceMeters: entry.route.distanceMeters,
      durationSeconds: entry.route.durationSeconds,
      coordinates: entry.route.coordinates.map(
        ([longitude, latitude]) => [longitude, latitude] as const,
      ),
    });

    topologies.push({
      vehicleId: entry.id,
      nodes: (entry.route.topologyNodes ?? []).map((node) => ({
        id: node.id,
        position: { ...node.position },
      })),
    });
  }

  if (roads.length > MAX_TOTAL_SEGMENTS) {
    throw new RangeError('Scenario has too many road segments');
  }

  const network = createRoadNetwork(roads);
  const simulation = createSimulation(network, startTimeMs, plans);

  return { network, simulation, routes: summaries, topologies };
}
