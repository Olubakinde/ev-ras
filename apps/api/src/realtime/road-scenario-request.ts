
import { BadRequestException } from '@nestjs/common';

import type {
  GeoPosition,
} from '../vehicles/domain/vehicle.js';

export type DemoVehicleId =
  | 'AMB-001'
  | 'CAR-001'
  | 'CAR-002';

export interface RoadScenarioVehicleRequest {
  readonly id: DemoVehicleId;
  readonly origin: GeoPosition;
  readonly destination: GeoPosition;
  readonly speedMps: number;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function parsePosition(
  value: unknown,
  field: string,
): GeoPosition {
  if (!isRecord(value)) {
    throw new BadRequestException(
      `${field} must be a coordinate object`,
    );
  }

  const { latitude, longitude } = value;

  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new BadRequestException(
      `${field} requires valid latitude and longitude`,
    );
  }

  return { latitude, longitude };
}

function parseVehicle(
  value: unknown,
  index: number,
): RoadScenarioVehicleRequest {
  if (!isRecord(value)) {
    throw new BadRequestException(
      `vehicles[${index}] must be an object`,
    );
  }

  const { id, speedMps } = value;

  if (
    id !== 'AMB-001' &&
    id !== 'CAR-001' &&
    id !== 'CAR-002'
  ) {
    throw new BadRequestException(
      'Unknown demo vehicle ID',
    );
  }

  if (
    typeof speedMps !== 'number' ||
    !Number.isFinite(speedMps) ||
    speedMps < 0 ||
    speedMps > 45 ||
    (id === 'AMB-001' && speedMps === 0)
  ) {
    throw new BadRequestException(
      `Invalid speed for ${id}; speedMps must be between 0 and 45, with a moving ambulance`,
    );
  }

  return {
    id,
    speedMps,
    origin: parsePosition(
      value.origin,
      `vehicles[${index}].origin`,
    ),
    destination: parsePosition(
      value.destination,
      `vehicles[${index}].destination`,
    ),
  };
}

export function parseRoadScenarioRequest(
  body: unknown,
): readonly RoadScenarioVehicleRequest[] {
  if (!isRecord(body) || !Array.isArray(body.vehicles)) {
    throw new BadRequestException(
      'Request requires a vehicles array',
    );
  }

  if (
    body.vehicles.length < 2 ||
    body.vehicles.length > 3
  ) {
    throw new BadRequestException(
      'Scenario requires 2 or 3 vehicles',
    );
  }

  const vehicles = body.vehicles.map(
    (value: unknown, index: number) =>
      parseVehicle(value, index),
  );

  const ids = new Set(vehicles.map((vehicle) => vehicle.id));

  if (ids.size !== vehicles.length) {
    throw new BadRequestException(
      'Duplicate scenario vehicle IDs',
    );
  }

  if (!ids.has('AMB-001') || !ids.has('CAR-001')) {
    throw new BadRequestException(
      'Scenario requires AMB-001 and CAR-001',
    );
  }

  return vehicles;
}
