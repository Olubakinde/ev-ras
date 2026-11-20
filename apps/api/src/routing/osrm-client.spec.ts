
import { describe, expect, it } from 'vitest';

import {
  advanceSimulation,
  createSimulation,
} from '../simulation/domain/simulation.js';

import {
  distanceMeters,
  getRoad,
} from '../simulation/domain/road-network.js';

import { OsrmClient } from './osrm-client.js';

const origin = {
  latitude: 39.6837,
  longitude: -75.75,
};

const destination = {
  latitude: 39.6847,
  longitude: -75.749,
};

const coordinates = [
  [-75.75, 39.6837],
  [-75.7495, 39.6837],
  [-75.749, 39.6837],
  [-75.749, 39.6847],
];

function osrmResponse(
  points: number[][] = coordinates,
): unknown {
  return {
    code: 'Ok',
    routes: [
      {
        distance: 220,
        duration: 25,
        geometry: {
          type: 'LineString',
          coordinates: points,
        },
      },
    ],
  };
}

function mockClient(
  body: unknown = osrmResponse(),
  status = 200,
): {
  client: OsrmClient;
  requestedUrls: string[];
} {
  const requestedUrls: string[] = [];

  const mockFetch = (async (
    input: string | URL | Request,
  ): Promise<Response> => {
    const requestedUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    requestedUrls.push(requestedUrl);

    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }) as typeof fetch;

  return {
    client: new OsrmClient(
      mockFetch,
      'https://routing.example.test',
    ),
    requestedUrls,
  };
}

describe('OsrmClient', () => {
  it('requests full GeoJSON driving geometry', async () => {
    const { client, requestedUrls } = mockClient();

    await client.getDrivingRoute(
      origin,
      destination,
      'AMB-001',
    );

    expect(requestedUrls).toHaveLength(1);

    const url = new URL(requestedUrls[0]);

    expect(url.pathname).toContain(
      '/route/v1/driving/-75.75,39.6837;-75.749,39.6847',
    );

    expect(url.searchParams.get('geometries')).toBe(
      'geojson',
    );

    expect(url.searchParams.get('overview')).toBe('full');
  });

  it('converts OSRM coordinates into road segments', async () => {
    const { client } = mockClient();

    const route = await client.getDrivingRoute(
      origin,
      destination,
      'AMB-001',
    );

    expect(route.segmentIds).toEqual([
      'AMB-001:0',
      'AMB-001:1',
      'AMB-001:2',
    ]);

    expect(route.roadNetwork.size).toBe(3);
    expect(route.distanceMeters).toBe(220);
    expect(route.durationSeconds).toBe(25);

    expect(route.snappedStart).toEqual(origin);
    expect(route.snappedEnd).toEqual(destination);
  });

  it('preserves connected route geometry', async () => {
    const { client } = mockClient();

    const route = await client.getDrivingRoute(
      origin,
      destination,
    );

    const first = getRoad(
      route.roadNetwork,
      route.segmentIds[0],
    );

    const second = getRoad(
      route.roadNetwork,
      route.segmentIds[1],
    );

    expect(
      distanceMeters(
        first.points[first.points.length - 1],
        second.points[0],
      ),
    ).toBe(0);
  });

  it('removes duplicate adjacent points', async () => {
    const { client } = mockClient(
      osrmResponse([
        coordinates[0],
        coordinates[0],
        coordinates[1],
      ]),
    );

    const route = await client.getDrivingRoute(
      origin,
      destination,
    );

    expect(route.segmentIds).toHaveLength(1);
  });

  it('produces a route usable by the simulation', async () => {
    const { client } = mockClient();

    const route = await client.getDrivingRoute(
      origin,
      destination,
      'AMB-001',
    );

    const simulation = createSimulation(
      route.roadNetwork,
      0,
      [
        {
          vehicle: {
            id: 'AMB-001',
            kind: 'EMERGENCY',
            position: route.snappedStart,
            speedMps: 10,
            headingDeg: 90,
            timestampMs: 0,
          },
          route: route.segmentIds,
        },
      ],
    );

    const next = advanceSimulation(
      route.roadNetwork,
      simulation,
      2000,
    );

    expect(next.timeMs).toBe(2000);

    expect(
      next.vehicles[0].vehicle.position.longitude,
    ).toBeGreaterThan(origin.longitude);

    expect(next.vehicles[0].finished).toBe(false);
  });

  it('rejects an invalid input position', async () => {
    const { client, requestedUrls } = mockClient();

    await expect(
      client.getDrivingRoute(
        { latitude: 120, longitude: 0 },
        destination,
      ),
    ).rejects.toThrow(RangeError);

    expect(requestedUrls).toHaveLength(0);
  });

  it('rejects a route provider HTTP failure', async () => {
    const { client } = mockClient(
      { message: 'Unavailable' },
      503,
    );

    await expect(
      client.getDrivingRoute(origin, destination),
    ).rejects.toThrow('HTTP 503');
  });

  it('rejects a response without a route', async () => {
    const { client } = mockClient({
      code: 'NoRoute',
      routes: [],
    });

    await expect(
      client.getDrivingRoute(origin, destination),
    ).rejects.toThrow(/could not calculate/);
  });

  it('rejects invalid returned coordinates', async () => {
    const { client } = mockClient(
      osrmResponse([
        coordinates[0],
        [200, 39.684],
      ]),
    );

    await expect(
      client.getDrivingRoute(origin, destination),
    ).rejects.toThrow(RangeError);
  });
});
