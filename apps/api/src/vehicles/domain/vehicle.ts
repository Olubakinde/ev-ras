
export type VehicleKind = 'EMERGENCY' | 'CIVILIAN';

export interface GeoPosition {
  readonly latitude: number;
  readonly longitude: number;
}

export interface VehicleState {
  readonly id: string;
  readonly kind: VehicleKind;
  readonly position: GeoPosition;
  readonly speedMps: number;
  readonly headingDeg: number;
  readonly timestampMs: number;
}

/**
 * Validates a vehicle's initial state before it enters
 * the EV-RAS simulation.
 *
 * @throws Error if the vehicle ID or kind is invalid.
 * @throws RangeError if geographic or motion values are invalid.
 */
export function createVehicle(
  state: VehicleState,
): VehicleState {
  if (typeof state.id !== 'string' || !state.id.trim()) {
    throw new Error('Vehicle ID cannot be empty');
  }

  if (state.kind !== 'EMERGENCY' && state.kind !== 'CIVILIAN') {
    throw new Error('Invalid vehicle kind');
  }

  if (!state.position) {
    throw new Error('Vehicle position is required');
  }

  const { latitude, longitude } = state.position;

  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new RangeError('Latitude must be between -90 and 90');
  }

  if (
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new RangeError('Longitude must be between -180 and 180');
  }

  if (
    !Number.isFinite(state.speedMps) ||
    state.speedMps < 0
  ) {
    throw new RangeError(
      'Speed must be a nonnegative finite number',
    );
  }

  if (
    !Number.isFinite(state.headingDeg) ||
    state.headingDeg < 0 ||
    state.headingDeg >= 360
  ) {
    throw new RangeError(
      'Heading must be between 0 (inclusive) and 360 (exclusive)',
    );
  }

  if (
    !Number.isFinite(state.timestampMs) ||
    state.timestampMs < 0
  ) {
    throw new RangeError(
      'Timestamp must be a nonnegative finite number',
    );
  }

  return state;
}
