import type { EncounterCandidate } from './encounter-detector.js';
import {
  assessRoadConflict,
  findSharedRoadEvidence,
  type VehicleRoadTopology,
} from './road-topology.js';

/**
 * A fail-closed selector used DURING candidate evaluation, before the detector
 * chooses the strongest arrival-time match for a driver.
 *
 * Cache the immutable topology pair's existence of shared road evidence for
 * the duration of one simulation tick. The authoritative location-specific
 * check still happens in assessRoadConflict; shared nodes elsewhere on the
 * route never authorize an unrelated crossing.
 *
 * Both route sets originate in the existing OSRM annotation pipeline. No
 * synthetic evidence is added here, and absence of evidence is not proof
 * that two roads are disconnected.
 */
export function createRoadEvidenceGate(
  topologies: readonly VehicleRoadTopology[],
): (candidate: EncounterCandidate) => boolean {
  const byVehicleId = new Map<string, VehicleRoadTopology>();
  for (const topology of topologies) {
    if (byVehicleId.has(topology.vehicleId)) {
      throw new Error(`Duplicate vehicle topology: ${topology.vehicleId}`);
    }
    byVehicleId.set(topology.vehicleId, topology);
  }

  const sharedEvidence = new Map<string, boolean>();
  return (candidate: EncounterCandidate): boolean => {
    const emergency = byVehicleId.get(candidate.emergencyVehicleId);
    const civilian = byVehicleId.get(candidate.civilianVehicleId);
    if (!emergency || !civilian) return false;

    const key = `${candidate.emergencyVehicleId.length}:${candidate.emergencyVehicleId}${candidate.civilianVehicleId}`;
    let hasSharedEvidence = sharedEvidence.get(key);
    if (hasSharedEvidence === undefined) {
      hasSharedEvidence = findSharedRoadEvidence(emergency, civilian).length > 0;
      sharedEvidence.set(key, hasSharedEvidence);
    }
    if (!hasSharedEvidence) return false;

    return assessRoadConflict(candidate, emergency, civilian).status === 'SUPPORTED';
  };
}
