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
import { DemoAccessService } from './demo-access.service.js';
import { DriversGateway } from './drivers.gateway.js';
import { io, type Socket as ClientSocket } from 'socket.io-client';

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
  let access: DemoAccessService;
  let gateway: DriversGateway;
  const clients: ClientSocket[] = [];
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
    access = app.get(DemoAccessService);
    gateway = app.get(DriversGateway);
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    clients.length = 0;
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
    expect(payload.encounterEvaluation).toBe('TOPOLOGY_FILTERED');
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
    expect(data.encounterEvaluation).toBe('TOPOLOGY_FILTERED');

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

  it('issues a scoped session for CAR-025, not arbitrary IDs', async () => {
    const session = await post('/demo/sessions', { driverId: 'CAR-025' });
    expect(session.status).toBe(201);
    const body = await session.json() as { driverId: string; token: string };
    expect(body.driverId).toBe('CAR-025');
    expect(access.resolveDriver(body.token)).toBe('CAR-025');
    expect(access.resolveDriver('bogus')).toBeNull();
    expect((await post('/demo/sessions', { driverId: 'CAR-026' })).status).toBe(400);
    expect((await post('/demo/sessions', { driverId: 'CAR-25' })).status).toBe(400);
  });

  it('delivers traffic ticks to a CAR-025 session without exposing other civilian states', async () => {
    expect((await post('/demo/traffic', {})).status).toBe(201);
    const token = access.issueDriverToken('CAR-025');
    const client = io(`${url}/drivers`, {
      auth: { token },
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
    });
    clients.push(client);
    const initial = new Promise<{ driver: { id: string }; alerts: unknown[] }>((resolve, reject) => {
      client.once('simulation:snapshot', resolve);
      client.once('connect_error', reject);
    });
    client.connect();
    const snapshot = await initial;
    expect(snapshot.driver.id).toBe('CAR-025');
    expect(Object.keys(snapshot)).not.toContain('vehicles');
    expect(snapshot.alerts).toEqual([]);

    const tickPromise = new Promise<{ driver: { id: string }; timeMs: number }>((resolve, reject) => {
      client.once('simulation:tick', resolve);
      client.once('connect_error', reject);
    });
    expect((await post('/demo/advance', { deltaMs: 1000 })).status).toBe(201);
    const tick = await tickPromise;
    expect(tick.driver.id).toBe('CAR-025');
    expect(tick.timeMs).toBe(1000);
  });

  it('sends a warning only to its authenticated driver room', async () => {
    expect((await post('/demo/traffic', {})).status).toBe(201);
    const connect = (driverId: string) => {
      const client = io(`${url}/drivers`, {
        auth: { token: access.issueDriverToken(driverId) },
        transports: ['websocket'],
        autoConnect: false,
        reconnection: false,
      });
      clients.push(client);
      const done = new Promise<void>((resolve, reject) => {
        client.once('session:ready', () => resolve());
        client.once('connect_error', reject);
      });
      client.connect();
      return { client, done };
    };
    const first = connect('CAR-001');
    const last = connect('CAR-025');
    await Promise.all([first.done, last.done]);
    const otherAlerts: unknown[] = [];
    first.client.on('alert:created', (alert: unknown) => { otherAlerts.push(alert); });
    const delivered = new Promise<{ civilianVehicleId: string }>((resolve) => {
      last.client.once('alert:created', resolve);
    });
    gateway.publishAlertEvents([{
      type: 'CREATED',
      alert: {
        id: 'encounter:AMB-001:CAR-025',
        emergencyVehicleId: 'AMB-001',
        civilianVehicleId: 'CAR-025',
        reason: 'CROSSING',
        classification: 'UNVERIFIED_ROUTE_ENCOUNTER',
        location: { latitude: 39.683, longitude: -75.75 },
        emergencyEtaSeconds: 5,
        civilianEtaSeconds: 5,
        etaDifferenceSeconds: 0,
        firstDetectedAtMs: 1000,
        lastUpdatedAtMs: 1000,
      },
    }]);
    expect((await delivered).civilianVehicleId).toBe('CAR-025');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(otherAlerts).toEqual([]);
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
