import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRoadNetwork, distanceMeters } from '../simulation/domain/road-network.js';
import type { DrivingRoute } from '../routing/osrm-client.js';
import { OsrmClient } from '../routing/osrm-client.js';
import type { GeoPosition } from '../vehicles/domain/vehicle.js';
import { DemoStateService } from './demo-state.service.js';
import { RealtimeModule } from './realtime.module.js';

const KEY = 'local-traffic-test-operator-key';
const originalKey = process.env.EVRAS_DEMO_OPERATOR_KEY;

function makeRoute(routeId: string): DrivingRoute {
  const number = routeId === 'AMB-001'
    ? 0
    : Number(routeId.split('-').at(-1) ?? '1');
  const points: GeoPosition[] = Array.from({ length: 12 }, (_, index) => ({
    latitude: 39.68 + number * 0.001,
    longitude: -75.76 + index * 0.00025,
  }));
  const roads = points.slice(1).map((point, index) => ({
    id: `${routeId}:${index}`,
    points: [points[index], point],
  }));
  const length = roads.reduce(
    (sum, road) => sum + distanceMeters(road.points[0], road.points[1]),
    0,
  );
  return {
    distanceMeters: length,
    durationSeconds: length / 12,
    coordinates: points.map((point) => [point.longitude, point.latitude] as const),
    roadNetwork: createRoadNetwork(roads),
    segmentIds: roads.map((road) => road.id),
    snappedStart: points[0],
    snappedEnd: points[points.length - 1],
  };
}

describe('25-car traffic API', () => {
  let app: INestApplication;
  let url: string;
  let state: DemoStateService;
  let getDrivingRoute: ReturnType<typeof vi.fn>;

  const post = async (path: string, body: unknown, authenticated = true) =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { 'x-demo-operator-key': KEY } : {}),
      },
      body: JSON.stringify(body),
    });

  beforeEach(async () => {
    process.env.EVRAS_DEMO_OPERATOR_KEY = KEY;
    getDrivingRoute = vi.fn(async (_from: GeoPosition, _to: GeoPosition, id: string) =>
      makeRoute(id),
    );
    const moduleRef = await Test.createTestingModule({
      imports: [RealtimeModule],
    })
      .overrideProvider(OsrmClient)
      .useValue({ getDrivingRoute })
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const address = (app.getHttpServer() as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
    state = app.get(DemoStateService);
  });

  afterEach(async () => {
    await app.close();
    if (originalKey === undefined) delete process.env.EVRAS_DEMO_OPERATOR_KEY;
    else process.env.EVRAS_DEMO_OPERATOR_KEY = originalKey;
  });

  it('rejects unauthenticated traffic initialization', async () => {
    const result = await post('/demo/traffic', { seed: 2026 }, false);
    expect(result.status).toBe(401);
    expect(getDrivingRoute).not.toHaveBeenCalled();
  });

  it('rejects invalid seeds before routing', async () => {
    const result = await post('/demo/traffic', { seed: -1 });
    expect(result.status).toBe(400);
    expect(getDrivingRoute).not.toHaveBeenCalled();
  });

  it('initializes 25 civilians plus the ambulance using six reusable OSRM routes', async () => {
    const result = await post('/demo/traffic', { seed: 123 });
    expect(result.status).toBe(201);
    const payload = await result.json() as {
      active: boolean;
      seed: number;
      source: string;
      encounterEvaluation: string;
      snapshot: { vehicles: Array<{ id: string; kind: string }> };
    };
    expect(payload.active).toBe(true);
    expect(payload.seed).toBe(123);
    expect(payload.source).toBe('OSRM');
    expect(payload.encounterEvaluation).toBe('DEFERRED_TO_10B');
    expect(payload.snapshot.vehicles).toHaveLength(26);
    expect(payload.snapshot.vehicles.filter((v) => v.kind === 'CIVILIAN')).toHaveLength(25);
    expect(getDrivingRoute).toHaveBeenCalledTimes(6);

    const routes = await fetch(`${url}/demo/routes`, {
      headers: { 'x-demo-operator-key': KEY },
    });
    const routeData = await routes.json() as { routes: unknown[] };
    expect(routeData.routes).toHaveLength(26);
  });

  it('advances and resets all 26 vehicles using existing endpoints', async () => {
    expect((await post('/demo/traffic', {})).status).toBe(201);
    const advanced = await post('/demo/advance', { deltaMs: 1000 });
    expect(advanced.status).toBe(201);
    const data = await advanced.json() as {
      timeMs: number;
      encounterEvaluation: string;
      snapshot: { vehicles: unknown[] };
    };
    expect(data.timeMs).toBe(1000);
    expect(data.snapshot.vehicles).toHaveLength(26);
    expect(data.encounterEvaluation).toBe('DEFERRED_TO_10B');

    const reset = await post('/demo/reset', {});
    const snapshot = await reset.json() as { timeMs: number; vehicles: unknown[] };
    expect(snapshot.timeMs).toBe(0);
    expect(snapshot.vehicles).toHaveLength(26);
  });

  it('preserves the previous simulation if any OSRM route fails', async () => {
    const prior = state.getOperatorSnapshot();
    getDrivingRoute.mockRejectedValueOnce(new Error('Unavailable'));
    expect((await post('/demo/traffic', { seed: 7 })).status).toBe(502);
    expect(state.getOperatorSnapshot()).toEqual(prior);
  });

  it('does not change existing two-vehicle route-scenario behavior', async () => {
    expect((await post('/demo/traffic', {})).status).toBe(201);
    const response = await post('/demo/route-scenario', {
      vehicles: [
        {
          id: 'AMB-001',
          origin: { latitude: 39.683, longitude: -75.755 },
          destination: { latitude: 39.683, longitude: -75.752 },
          speedMps: 15,
        },
        {
          id: 'CAR-001',
          origin: { latitude: 39.681, longitude: -75.755 },
          destination: { latitude: 39.681, longitude: -75.752 },
          speedMps: 12,
        },
      ],
    });
    expect(response.status).toBe(201);
    expect(state.getOperatorSnapshot().vehicles).toHaveLength(2);
    const traffic = await fetch(`${url}/demo/traffic`, {
      headers: { 'x-demo-operator-key': KEY },
    });
    const status = await traffic.json() as { active: boolean };
    expect(status.active).toBe(false);
  });
});
