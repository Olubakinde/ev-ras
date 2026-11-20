
import type {
    EncounterCandidate,
    EncounterReason,
  } from '../../detection/domain/encounter-detector.js';

  import type {
    GeoPosition,
  } from '../../vehicles/domain/vehicle.js';

  /**
   * An active advisory based on an unverified route
   * encounter candidate.
   *
   * This is simulation output, not a confirmed hazard
   * or a production emergency warning.
   */
  export interface DriverAlert {
    readonly id: string;
    readonly emergencyVehicleId: string;
    readonly civilianVehicleId: string;
    readonly location: GeoPosition;
    readonly reason: EncounterReason;
    readonly classification: 'UNVERIFIED_ROUTE_ENCOUNTER';
    readonly emergencyEtaSeconds: number;
    readonly civilianEtaSeconds: number | null;
    readonly etaDifferenceSeconds: number | null;
    readonly firstDetectedAtMs: number;
    readonly lastUpdatedAtMs: number;
  }

  export type AlertEventType =
    | 'CREATED'
    | 'UPDATED'
    | 'CLEARED';

  export interface AlertEvent {
    readonly type: AlertEventType;
    readonly alert: DriverAlert;
  }

  export interface AlertReconciliationResult {
    readonly active: readonly DriverAlert[];
    readonly events: readonly AlertEvent[];
  }

  const VALID_REASONS: readonly string[] = [
    'CROSSING',
    'SHARED_PATH',
    'NEAR_PATH',
    'STATIONARY_ON_PATH',
  ];

  function validEta(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
  }

  /**
   * Creates a stable identifier for a specific emergency
   * vehicle / civilian driver pair.
   *
   * Encoding prevents collisions between IDs containing
   * separator characters.
   */
  export function createAlertId(
    emergencyVehicleId: string,
    civilianVehicleId: string,
  ): string {
    if (
      typeof emergencyVehicleId !== 'string' ||
      !emergencyVehicleId.trim() ||
      typeof civilianVehicleId !== 'string' ||
      !civilianVehicleId.trim()
    ) {
      throw new Error('Alert vehicle IDs cannot be empty');
    }

    return (
      `encounter:${encodeURIComponent(emergencyVehicleId)}` +
      `:${encodeURIComponent(civilianVehicleId)}`
    );
  }

  /**
   * Reject invalid encounter data before creating an alert.
   */
  function validateCandidate(
    candidate: EncounterCandidate,
  ): void {
    createAlertId(
      candidate.emergencyVehicleId,
      candidate.civilianVehicleId,
    );

    if (!VALID_REASONS.includes(candidate.reason)) {
      throw new Error('Invalid encounter reason');
    }

    const position = candidate.location;

    if (
      !position ||
      !Number.isFinite(position.latitude) ||
      position.latitude < -90 ||
      position.latitude > 90 ||
      !Number.isFinite(position.longitude) ||
      position.longitude < -180 ||
      position.longitude > 180
    ) {
      throw new RangeError('Invalid encounter location');
    }

    if (!validEta(candidate.emergencyEtaSeconds)) {
      throw new RangeError('Invalid emergency vehicle ETA');
    }

    if (
      candidate.civilianEtaSeconds !== null &&
      !validEta(candidate.civilianEtaSeconds)
    ) {
      throw new RangeError('Invalid civilian vehicle ETA');
    }

    if (
      candidate.etaDifferenceSeconds !== null &&
      !validEta(candidate.etaDifferenceSeconds)
    ) {
      throw new RangeError('Invalid ETA difference');
    }

    if (
      (candidate.civilianEtaSeconds === null) !==
      (candidate.etaDifferenceSeconds === null)
    ) {
      throw new Error('Inconsistent encounter ETA values');
    }
  }

  /**
   * Detect whether an existing alert contains the same
   * encounter information as the latest candidate.
   *
   * Identical predictions do not generate repeated events.
   */
  function sameEncounter(
    alert: DriverAlert,
    candidate: EncounterCandidate,
  ): boolean {
    return (
      alert.reason === candidate.reason &&
      alert.location.latitude ===
        candidate.location.latitude &&
      alert.location.longitude ===
        candidate.location.longitude &&
      alert.emergencyEtaSeconds ===
        candidate.emergencyEtaSeconds &&
      alert.civilianEtaSeconds ===
        candidate.civilianEtaSeconds &&
      alert.etaDifferenceSeconds ===
        candidate.etaDifferenceSeconds
    );
  }

  function cloneAlert(alert: DriverAlert): DriverAlert {
    return {
      ...alert,
      location: { ...alert.location },
    };
  }

  function buildAlert(
    candidate: EncounterCandidate,
    nowMs: number,
    previous?: DriverAlert,
  ): DriverAlert {
    return {
      id: createAlertId(
        candidate.emergencyVehicleId,
        candidate.civilianVehicleId,
      ),
      emergencyVehicleId: candidate.emergencyVehicleId,
      civilianVehicleId: candidate.civilianVehicleId,
      location: { ...candidate.location },
      reason: candidate.reason,
      classification: 'UNVERIFIED_ROUTE_ENCOUNTER',
      emergencyEtaSeconds:
        candidate.emergencyEtaSeconds,
      civilianEtaSeconds:
        candidate.civilianEtaSeconds,
      etaDifferenceSeconds:
        candidate.etaDifferenceSeconds,
      firstDetectedAtMs:
        previous?.firstDetectedAtMs ?? nowMs,
      lastUpdatedAtMs: nowMs,
    };
  }

  /**
   * Reconciles existing alerts with the latest encounter
   * detection results.
   *
   * - New candidate       -> CREATED
   * - Changed candidate   -> UPDATED
   * - Identical candidate -> No event
   * - Missing candidate   -> CLEARED
   *
   * The function uses an externally supplied simulation
   * timestamp and does not mutate previous state.
   *
   * Each reconciliation must receive the complete current
   * candidate set, not a partial batch.
   */
  export function reconcileAlerts(
    previous: readonly DriverAlert[],
    candidates: readonly EncounterCandidate[],
    nowMs: number,
  ): AlertReconciliationResult {
    if (!Number.isFinite(nowMs) || nowMs < 0) {
      throw new RangeError(
        'Alert timestamp must be finite and nonnegative',
      );
    }

    const previousById = new Map<string, DriverAlert>();
    const candidatesById = new Map<
      string,
      EncounterCandidate
    >();

    for (const alert of previous) {
      if (previousById.has(alert.id)) {
        throw new Error(
          `Duplicate existing alert: ${alert.id}`,
        );
      }

      if (
        !Number.isFinite(alert.lastUpdatedAtMs) ||
        nowMs < alert.lastUpdatedAtMs
      ) {
        throw new RangeError(
          'Alert timestamps cannot move backwards',
        );
      }

      previousById.set(alert.id, alert);
    }

    for (const candidate of candidates) {
      validateCandidate(candidate);

      const id = createAlertId(
        candidate.emergencyVehicleId,
        candidate.civilianVehicleId,
      );

      if (candidatesById.has(id)) {
        throw new Error(
          `Duplicate encounter candidate: ${id}`,
        );
      }

      candidatesById.set(id, candidate);
    }

    const active: DriverAlert[] = [];
    const events: AlertEvent[] = [];

    // Clear alerts that are no longer detected.
    for (const [id, alert] of previousById) {
      if (!candidatesById.has(id)) {
        events.push({
          type: 'CLEARED',
          alert: {
            ...cloneAlert(alert),
            lastUpdatedAtMs: nowMs,
          },
        });
      }
    }

    // Create or update current encounters.
    for (const [id, candidate] of candidatesById) {
      const existing = previousById.get(id);

      if (!existing) {
        const alert = buildAlert(candidate, nowMs);

        active.push(alert);
        events.push({
          type: 'CREATED',
          alert: cloneAlert(alert),
        });

        continue;
      }

      if (sameEncounter(existing, candidate)) {
        active.push(cloneAlert(existing));
        continue;
      }

      const updated = buildAlert(
        candidate,
        nowMs,
        existing,
      );

      active.push(updated);

      events.push({
        type: 'UPDATED',
        alert: cloneAlert(updated),
      });
    }

    // Stable ordering makes test results and event
    // delivery deterministic.
    active.sort((a, b) => a.id.localeCompare(b.id));

    events.sort((a, b) =>
      a.alert.id.localeCompare(b.alert.id),
    );

    return { active, events };
  }
