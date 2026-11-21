import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createRoadNetwork, distanceMeters } from '../simulation/domain/road-network.js';
import type { DrivingRoute } from '../routing/osrm-client.js';
import { OsrmClient } from '../routing/osrm-client.js';
import type { GeoPosition } from '../vehicles/domain/vehicle.js';
import { RealtimeModule } from './realtime.module.js';

const KEY = 'reseed-test-operator-secret';
const oldKey = process.env.EVRAS_DEMO_OPERATOR_KEY;

function route(id: string): DrivingRoute {
  const number = id === 'AMB-001' ? 0 : Number(id.split('-').at(-1) ?? '1');
  const positions: GeoPosition[] = Array.from({ length: 14 }, (_, index) => ({
    latitude: 39.68 + number * 0.001,
    longitude: -75.76 + index * 0.00025,
  }));
  const segments = positions.slice(1).map((point, index) => ({
    id: `${id}:${index}`,
    points: [positions[index], point],
  }));
  const distance = segments.reduce(
    (sum, segment) => sum + distanceMeters(segment.points[0], segment.points[1]), 0,
  );
  return {
    distanceMeters: distance,
    durationSeconds: distance / 10,
    coordinates: positions.map((p) => [p.longitude, p.latitude] as const),
    roadNetwork: createRoadNetwork(segments),
    segmentIds: segments.map((segment) => segment.id),
    snappedStart: positions[0],
    snappedEnd: positions[positions.length - 1],
  };
}

describe('operator-only traffic reseeding on fixed OSRM geometry', () => {
  let app: INestApplication;
  let url: string;
  let getDrivingRoute: ReturnType<typeof vi.fn>;
  const post = (path: string, body: unknown, withKey = true) =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(withKey ? { 'x-demo-operator-key': KEY } : {}),
      },
      body: JSON.stringify(body),
    });

  beforeEach(async () => {
    process.env.EVRAS_DEMO_OPERATOR_KEY = KEY;
    getDrivingRoute = vi.fn(async (_from: GeoPosition, _to: GeoPosition, id: string) => route(id));
    const moduleRef = await Test.createTestingModule({ imports: [RealtimeModule] })
      .overrideProvider(OsrmClient)
      .useValue({ getDrivingRoute })
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const address = (app.getHttpServer() as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await app.close();
    if (oldKey === undefined) delete process.env.EVRAS_DEMO_OPERATOR_KEY;
    else process.env.EVRAS_DEMO_OPERATOR_KEY = oldKey;
  });

  it('rejects unauthenticated reseeding before reading any scenario', async () => {
    const result = await post('/demo/traffic/reseed', { seed: 10 }, false);
    expect(result.status).toBe(401);
    expect(getDrivingRoute).not.toHaveBeenCalled();
  });

  it('rejects reseeding before a traffic scenario has been loaded', async () => {
    const result = await post('/demo/traffic/reseed', { seed: 2026 });
    expect(result.status).toBe(409);
  });

  it('rejects negative, fractional, and missing seeds without disturbing traffic', async () => {
    expect((await post('/demo/traffic', { seed: 2026 })).status).toBe(201);
    for (const body of [{ seed: -1 }, { seed: 2.5 }, {}, { seed: '2026' }]) {
      expect((await post('/demo/traffic/reseed', body)).status).toBe(400);
    }
    const metadata = await fetch(`${url}/demo/traffic`, {
      headers: { 'x-demo-operator-key': KEY },
    });
    expect((await metadata.json() as { seed: number }).seed).toBe(2026);
    expect(getDrivingRoute).toHaveBeenCalledTimes(6);
  });

  it('reuses exactly the same six OSRM routes across multiple seeds', async () => {
    const initialized = await post('/demo/traffic', { seed: 2026 });
    expect(initialized.status).toBe(201);
    expect(getDrivingRoute).toHaveBeenCalledTimes(6);
    for (const seed of [2027, 2028, 2029]) {
      const response = await post('/demo/traffic/reseed', { seed });
      expect(response.status).toBe(201);
      const data = await response.json() as {
        seed: number;
        source: string;
        civilianCount: number;
        snapshot: { timeMs: number; vehicles: unknown[] };
      };
      expect(data.seed).toBe(seed);
      expect(data.source).toBe('OSRM');
      expect(data.civilianCount).toBe(25);
      expect(data.snapshot.timeMs).toBe(0);
      expect(data.snapshot.vehicles).toHaveLength(26);
      expect(getDrivingRoute).toHaveBeenCalledTimes(6);
    }
  });

  it('restores the same positions and speeds for a repeated seed', async () => {
    expect((await post('/demo/traffic', { seed: 11 })).status).toBe(201);
    const firstResponse = await post('/demo/traffic/reseed', { seed: 12 });
    const first = await firstResponse.json() as { snapshot: { vehicles: unknown[] } };
    await post('/demo/advance', { deltaMs: 1000 });
    const secondResponse = await post('/demo/traffic/reseed', { seed: 12 });
    const second = await secondResponse.json() as { snapshot: { timeMs: number; vehicles: unknown[]; alerts: unknown[] } };
    expect(second.snapshot.vehicles).toEqual(first.snapshot.vehicles);
    expect(second.snapshot.timeMs).toBe(0);
    expect(second.snapshot.alerts).toEqual([]);
    expect(getDrivingRoute).toHaveBeenCalledTimes(6);
  });

  it('supports the seed bounds without new routing requests', async () => {
    expect((await post('/demo/traffic', { seed: 2026 })).status).toBe(201);
    expect((await post('/demo/traffic/reseed', { seed: 0 })).status).toBe(201);
    expect((await post('/demo/traffic/reseed', { seed: 4_294_967_295 })).status).toBe(201);
    expect(getDrivingRoute).toHaveBeenCalledTimes(6);
  });
});
