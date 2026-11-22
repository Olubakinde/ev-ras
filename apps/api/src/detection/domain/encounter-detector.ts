
import { lineString } from '@turf/helpers';
import { lineIntersect } from '@turf/line-intersect';
import { nearestPointOnLine } from '@turf/nearest-point-on-line';

import type { GeoPosition } from '../../vehicles/domain/vehicle.js';
import {
  distanceMeters,
  getRoad,
  pointOnRoad,
  type RoadNetwork,
} from '../../simulation/domain/road-network.js';
import type { SimulatedVehicle } from '../../simulation/domain/simulation.js';

export interface VehicleJourney {
  readonly network: RoadNetwork;
  readonly state: SimulatedVehicle;
}

export type EncounterReason =
  | 'CROSSING'
  | 'SHARED_PATH'
  | 'NEAR_PATH'
  | 'STATIONARY_ON_PATH';

export interface EncounterCandidate {
  readonly emergencyVehicleId: string;
  readonly civilianVehicleId: string;
  readonly location: GeoPosition;
  readonly reason: EncounterReason;
  readonly emergencyEtaSeconds: number;
  readonly civilianEtaSeconds: number | null;
  readonly etaDifferenceSeconds: number | null;
}

/** Optional, experimental travel-time model. null means that arrival is not predicted. */
export type ArrivalTimeEstimator = (journey: VehicleJourney, distanceM: number) => number | null;

/** A policy applied BEFORE the per-driver best-candidate selection. */
export type CandidateEligibility = (candidate: EncounterCandidate) => boolean;

export interface DetectionOptions {
  readonly horizonSeconds?: number;
  readonly arrivalWindowSeconds?: number;
  readonly routeToleranceMeters?: number;
}

interface CandidateLocation {
  readonly coords: number[];
  readonly reason: 'CROSSING' | 'NEAR_PATH';
}

const DEFAULTS = {
  horizonSeconds: 45,
  arrivalWindowSeconds: 5,
  routeToleranceMeters: 2,
} as const;

function validateOptions(options: Required<DetectionOptions>): void {
  if (
    !Number.isFinite(options.horizonSeconds) ||
    options.horizonSeconds <= 0 ||
    !Number.isFinite(options.arrivalWindowSeconds) ||
    options.arrivalWindowSeconds < 0 ||
    !Number.isFinite(options.routeToleranceMeters) ||
    options.routeToleranceMeters < 0
  ) {
    throw new RangeError('Invalid encounter detection options');
  }
}

const toCoords = (position: GeoPosition): number[] => [
  position.longitude,
  position.latitude,
];

const fromCoords = (coords: readonly number[]): GeoPosition => ({
  longitude: coords[0],
  latitude: coords[1],
});

/**
 * Build only the route remaining ahead of the vehicle.
 *
 * Already-traversed road geometry is excluded so that
 * past intersections cannot generate new predictions.
 */
function remainingCoordinates(
  journey: VehicleJourney,
): number[][] | null {
  const { state, network } = journey;

  if (state.finished) {
    return null;
  }

  const active = getRoad(
    network,
    state.route[state.segmentIndex],
  );

  const current = pointOnRoad(
    active,
    state.distanceOnSegmentM,
  ).position;

  const positions: GeoPosition[] = [current];

  for (
    let i = state.segmentIndex;
    i < state.route.length;
    i++
  ) {
    const road = getRoad(network, state.route[i]);
    let traversed = 0;

    for (let j = 1; j < road.points.length; j++) {
      traversed += distanceMeters(
        road.points[j - 1],
        road.points[j],
      );

      if (
        i === state.segmentIndex &&
        traversed <= state.distanceOnSegmentM + 1e-7
      ) {
        continue;
      }

      const next = road.points[j];

      if (
        distanceMeters(
          positions[positions.length - 1],
          next,
        ) > 1e-5
      ) {
        positions.push(next);
      }
    }
  }

  return positions.length >= 2
    ? positions.map(toCoords)
    : null;
}

/**
 * Checks whether two remaining routes contain matching
 * road segments, including reverse-direction segments.
 *
 * This is an initial geometric match, not a complete
 * road-topology verification.
 */
function hasSharedSegment(
  first: readonly number[][],
  second: readonly number[][],
  toleranceM: number,
): boolean {
  for (let i = 1; i < first.length; i++) {
    for (let j = 1; j < second.length; j++) {
      const a0 = fromCoords(first[i - 1]);
      const a1 = fromCoords(first[i]);
      const b0 = fromCoords(second[j - 1]);
      const b1 = fromCoords(second[j]);

      if (
        (distanceMeters(a0, b0) <= toleranceM &&
          distanceMeters(a1, b1) <= toleranceM) ||
        (distanceMeters(a0, b1) <= toleranceM &&
          distanceMeters(a1, b0) <= toleranceM)
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Evaluates one civilian against one emergency vehicle.
 */
function estimatedTravelTime(
  journey: VehicleJourney,
  distanceM: number,
  estimator: ArrivalTimeEstimator | undefined,
): number | null {
  const result = estimator
    ? estimator(journey, distanceM)
    : distanceM / journey.state.vehicle.speedMps;
  if (result === null) return null;
  if (!Number.isFinite(result) || result < 0) {
    throw new RangeError('Arrival estimator returned an invalid ETA');
  }
  return result;
}

function evaluateDriver(
  emergency: VehicleJourney,
  civilian: VehicleJourney,
  settings: Required<DetectionOptions>,
  acceptCandidate: CandidateEligibility,
  estimateArrival?: ArrivalTimeEstimator,
): EncounterCandidate | null {
  const ambulance = emergency.state.vehicle;
  const driver = civilian.state.vehicle;

  if (ambulance.timestampMs !== driver.timestampMs) {
    throw new Error(
      'Vehicle snapshots must use the same simulation time',
    );
  }

  if (civilian.state.finished || ambulance.speedMps === 0) {
    return null;
  }

  const emergencyCoords = remainingCoordinates(emergency);

  if (!emergencyCoords) {
    return null;
  }

  const emergencyLine = lineString(emergencyCoords);

  // Stationary vehicles need special handling because
  // their travel ETA is undefined.
  if (driver.speedMps === 0) {
    const closest = nearestPointOnLine(
      emergencyLine,
      toCoords(driver.position),
      { units: 'meters' },
    );

    const eta = estimatedTravelTime(emergency, closest.properties.location, estimateArrival);

    if (
      closest.properties.dist >
        settings.routeToleranceMeters ||
      eta === null || eta > settings.horizonSeconds
    ) {
      return null;
    }

    const result: EncounterCandidate = {
      emergencyVehicleId: ambulance.id,
      civilianVehicleId: driver.id,
      location: fromCoords(closest.geometry.coordinates),
      reason: 'STATIONARY_ON_PATH',
      emergencyEtaSeconds: eta,
      civilianEtaSeconds: null,
      etaDifferenceSeconds: null,
    };
    return acceptCandidate(result) ? result : null;
  }

  const driverCoords = remainingCoordinates(civilian);

  if (!driverCoords) {
    return null;
  }

  const driverLine = lineString(driverCoords);

  const sharedSegment = hasSharedSegment(
    emergencyCoords,
    driverCoords,
    settings.routeToleranceMeters,
  );

  // Find exact geometric intersections.
  const candidates: CandidateLocation[] = lineIntersect(
    emergencyLine,
    driverLine,
  ).features.map((feature) => ({
    coords: feature.geometry.coordinates,
    reason: 'CROSSING',
  }));

  // Also inspect nearby route vertices. This supports
  // shared paths and small differences in route geometry.
  for (const [source, target] of [
    [emergencyCoords, driverLine],
    [driverCoords, emergencyLine],
  ] as const) {
    for (const coords of source) {
      const nearest = nearestPointOnLine(
        target,
        coords,
        { units: 'meters' },
      );

      if (
        nearest.properties.dist <=
        settings.routeToleranceMeters
      ) {
        candidates.push({
          coords,
          reason: 'NEAR_PATH',
        });
      }
    }
  }

  let best: EncounterCandidate | null = null;

  for (const candidate of candidates) {
    const e = nearestPointOnLine(
      emergencyLine,
      candidate.coords,
      { units: 'meters' },
    );

    const c = nearestPointOnLine(
      driverLine,
      candidate.coords,
      { units: 'meters' },
    );

    if (
      e.properties.dist > settings.routeToleranceMeters ||
      c.properties.dist > settings.routeToleranceMeters
    ) {
      continue;
    }

    const emergencyEta = estimatedTravelTime(emergency, e.properties.location, estimateArrival);

    const civilianEta = estimatedTravelTime(civilian, c.properties.location, estimateArrival);

    if (emergencyEta === null || civilianEta === null) continue;
    const difference = Math.abs(
      emergencyEta - civilianEta,
    );

    // Reject encounters outside our prediction horizon
    // or those whose arrival times are too far apart.
    if (
      emergencyEta > settings.horizonSeconds ||
      civilianEta > settings.horizonSeconds ||
      difference > settings.arrivalWindowSeconds
    ) {
      continue;
    }

    const result: EncounterCandidate = {
      emergencyVehicleId: ambulance.id,
      civilianVehicleId: driver.id,
      location: fromCoords(e.geometry.coordinates),
      reason: sharedSegment
        ? 'SHARED_PATH'
        : candidate.reason,
      emergencyEtaSeconds: emergencyEta,
      civilianEtaSeconds: civilianEta,
      etaDifferenceSeconds: difference,
    };

    // Evidence and policy are evaluated before choosing the best ETA match.
    if (!acceptCandidate(result)) continue;

    // Keep the strongest candidate for this driver:
    // closest predicted arrival times, then earliest ETA.
    if (
      !best ||
      difference <
        (best.etaDifferenceSeconds ?? Infinity) - 1e-6 ||
      (Math.abs(
        difference -
          (best.etaDifferenceSeconds ?? Infinity),
      ) < 1e-6 &&
        emergencyEta < best.emergencyEtaSeconds)
    ) {
      best = result;
    }
  }

  return best;
}

/**
 * Detects upcoming geometric encounter candidates.
 *
 * Returns at most one candidate per civilian driver.
 *
 * This is a deterministic prediction baseline.
 * It does not confirm at-grade road connectivity,
 * calculate collision probability, or issue alerts.
 */
export function detectEncounters(
  emergency: VehicleJourney,
  civilians: readonly VehicleJourney[],
  options: DetectionOptions = {},
  acceptCandidate: CandidateEligibility = () => true,
  estimateArrival?: ArrivalTimeEstimator,
): EncounterCandidate[] {
  const settings = { ...DEFAULTS, ...options };

  validateOptions(settings);

  if (emergency.state.vehicle.kind !== 'EMERGENCY') {
    throw new Error(
      'First journey must be an emergency vehicle',
    );
  }

  const ids = new Set<string>();
  const encounters: EncounterCandidate[] = [];

  for (const civilian of civilians) {
    if (civilian.state.vehicle.kind !== 'CIVILIAN') {
      throw new Error(
        'Only civilian journeys may be evaluated',
      );
    }

    if (ids.has(civilian.state.vehicle.id)) {
      throw new Error('Duplicate civilian vehicle ID');
    }

    ids.add(civilian.state.vehicle.id);

    const encounter = evaluateDriver(
      emergency,
      civilian,
      settings,
      acceptCandidate,
      estimateArrival,
    );

    if (encounter) {
      encounters.push(encounter);
    }
  }

  return encounters.sort(
    (a, b) =>
      a.emergencyEtaSeconds - b.emergencyEtaSeconds ||
      a.civilianVehicleId.localeCompare(
        b.civilianVehicleId,
      ),
  );
}
