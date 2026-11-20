
import {
    BadGatewayException,
    BadRequestException,
    Controller,
    Get,
    Query,
  } from '@nestjs/common';

  import type { GeoPosition } from '../vehicles/domain/vehicle.js';
  import { OsrmClient } from './osrm-client.js';

  function parseCoordinates(
    value: string | undefined,
    field: string,
  ): GeoPosition {
    if (typeof value !== 'string') {
      throw new BadRequestException(
        `${field} must be longitude,latitude`,
      );
    }

    const parts = value.split(',');

    if (
      parts.length !== 2 ||
      parts.some((part) => part.trim() === '')
    ) {
      throw new BadRequestException(
        `${field} must be longitude,latitude`,
      );
    }

    const longitude = Number(parts[0]);
    const latitude = Number(parts[1]);

    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    ) {
      throw new BadRequestException(
        `${field} contains invalid coordinates`,
      );
    }

    return { latitude, longitude };
  }

  @Controller('routes')
  export class RoutingController {
    constructor(private readonly osrm: OsrmClient) {}

    @Get('driving')
    async getDrivingRoute(
      @Query('from') from?: string,
      @Query('to') to?: string,
    ) {
      const origin = parseCoordinates(from, 'from');
      const destination = parseCoordinates(to, 'to');

      try {
        const route = await this.osrm.getDrivingRoute(
          origin,
          destination,
        );

        return {
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          snappedStart: route.snappedStart,
          snappedEnd: route.snappedEnd,
          segmentCount: route.segmentIds.length,
          geometry: {
            type: 'LineString' as const,
            coordinates: route.coordinates,
          },
        };
      } catch {
        throw new BadGatewayException(
          'Unable to calculate a driving route',
        );
      }
    }
  }
