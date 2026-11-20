import type { EncounterCandidate } from './encounter-detector.js';

import {
  filterTopologicallySupportedEncounters,
  type VehicleRoadTopology,
} from './road-topology.js';

export type EncounterEvidenceMode = 'DEMO' | 'OSRM';

/**
 * The controlled demonstration keeps its existing geometry-based advisories.
 * Real OSRM scenarios require positive OSM node/edge evidence at the candidate
 * location. Missing or incompatible annotations result in no driver alert.
 *
 * Note: filtering after candidate selection can miss a later, supported
 * crossing if the geometric detector selected a different one first. We
 * prefer this conservative false negative to an unsupported warning.
 */
export function selectAlertableEncounters(
  candidates: readonly EncounterCandidate[],
  mode: EncounterEvidenceMode,
  topologies: readonly VehicleRoadTopology[],
): EncounterCandidate[] {
  if (mode === 'DEMO') {
    return [...candidates];
  }

  return filterTopologicallySupportedEncounters(candidates, topologies);
}
