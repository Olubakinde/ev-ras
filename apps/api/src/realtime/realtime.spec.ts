
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  io,
  type Socket as ClientSocket,
} from 'socket.io-client';

import type { DriverAlert } from '../alerts/domain/alert-manager.js';

import { DemoAccessService } from './demo-access.service.js';
import { DemoSimulationService } from './demo-simulation.service.js';
import {
  DemoStateService,
  type DriverSnapshot,
} from './demo-state.service.js';
import { RealtimeModule } from './realtime.module.js';

const OPERATOR_KEY = 'test-only-operator-secret-2026';

const previousOperatorKey =
  process.env.EVRAS_DEMO_OPERATOR_KEY;

describe('EV-RAS real-time integration', () => {
  let app: INestApplication;
  let baseUrl: string;

  let access: DemoAccessService;
  let simulation: DemoSimulationService;
  let state: DemoStateService;

  const clients: ClientSocket[] = [];

  function createClient(token: string): ClientSocket {
    const client = io(`${baseUrl}/drivers`, {
      auth: { token },
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
      timeout: 5000,
    });

    clients.push(client);

    return client;
  }

  async function connect(
    client: ClientSocket,
  ): Promise<void> {
    const connected = new Promise<void>(
      (resolve, reject) => {
        client.once('connect', () => resolve());
        client.once('connect_error', reject);
      },
    );

    client.connect();

    await connected;
  }

  function nextEvent<T>(
    client: ClientSocket,
    eventName: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(`Timed out waiting for ${eventName}`),
        );
      }, 5000);

      client.once(eventName, (payload: T) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });
  }

  beforeEach(async () => {
    process.env.EVRAS_DEMO_OPERATOR_KEY = OPERATOR_KEY;

    const moduleRef = await Test.createTestingModule({
      imports: [RealtimeModule],
    }).compile();

    app = moduleRef.createNestApplication();

    await app.listen(0, '127.0.0.1');

    const server = app.getHttpServer() as Server;
    const address = server.address() as AddressInfo;

    baseUrl = `http://127.0.0.1:${address.port}`;

    access = app.get(DemoAccessService);
    simulation = app.get(DemoSimulationService);
    state = app.get(DemoStateService);
  });

  afterEach(async () => {
    for (const client of clients) {
      client.disconnect();
    }

    clients.length = 0;

    await app.close();

    if (previousOperatorKey === undefined) {
      delete process.env.EVRAS_DEMO_OPERATOR_KEY;
    } else {
      process.env.EVRAS_DEMO_OPERATOR_KEY =
        previousOperatorKey;
    }
  });

  it('authenticates a driver and sends its initial snapshot', async () => {
    const token = access.issueDriverToken('CAR-001');
    const client = createClient(token);

    const readyPromise = nextEvent<{
      driverId: string;
    }>(client, 'session:ready');

    const snapshotPromise = nextEvent<DriverSnapshot>(
      client,
      'simulation:snapshot',
    );

    await connect(client);

    const ready = await readyPromise;
    const snapshot = await snapshotPromise;

    expect(ready.driverId).toBe('CAR-001');
    expect(snapshot.driver.id).toBe('CAR-001');
    expect(snapshot.timeMs).toBe(0);

    expect(snapshot.emergencyVehicles).toHaveLength(1);
    expect(snapshot.alerts).toEqual([]);
  });

  it('rejects unauthorized Socket.IO connections', async () => {
    const client = createClient('invalid-token');

    const errorPromise = nextEvent<Error>(
      client,
      'connect_error',
    );

    client.connect();

    const error = await errorPromise;

    expect(error.message).toContain(
      'Unauthorized driver session',
    );

    expect(client.connected).toBe(false);
  });

  it('sends an encounter warning only to the affected driver', async () => {
    const first = createClient(
      access.issueDriverToken('CAR-001'),
    );

    const second = createClient(
      access.issueDriverToken('CAR-002'),
    );

    await Promise.all([
      connect(first),
      connect(second),
    ]);

    const otherDriverAlerts: DriverAlert[] = [];

    second.on('alert:created', (alert: DriverAlert) => {
      otherDriverAlerts.push(alert);
    });

    const warningPromise = nextEvent<DriverAlert>(
      first,
      'alert:created',
    );

    const result = simulation.advance(1000);
    const warning = await warningPromise;

    expect(result.encounterCount).toBe(1);

    expect(warning.civilianVehicleId).toBe(
      'CAR-001',
    );

    expect(warning.emergencyVehicleId).toBe(
      'AMB-001',
    );

    expect(warning.classification).toBe(
      'UNVERIFIED_ROUTE_ENCOUNTER',
    );

    await new Promise((resolve) =>
      setTimeout(resolve, 30),
    );

    expect(otherDriverAlerts).toEqual([]);

    expect(
      state.snapshotForDriver('CAR-002')?.alerts,
    ).toEqual([]);
  });

  it('clears a warning after the encounter is no longer ahead', async () => {
    const client = createClient(
      access.issueDriverToken('CAR-001'),
    );

    await connect(client);

    const createdPromise = nextEvent<DriverAlert>(
      client,
      'alert:created',
    );

    simulation.advance(1000);
    await createdPromise;

    const clearedPromise = nextEvent<DriverAlert>(
      client,
      'alert:cleared',
    );

    simulation.advance(6000);

    const cleared = await clearedPromise;

    expect(cleared.civilianVehicleId).toBe(
      'CAR-001',
    );

    expect(
      state.snapshotForDriver('CAR-001')?.alerts,
    ).toEqual([]);
  });

  it('sends active alerts when a driver connects late', async () => {
    simulation.advance(1000);

    const client = createClient(
      access.issueDriverToken('CAR-001'),
    );

    const snapshotPromise = nextEvent<DriverSnapshot>(
      client,
      'simulation:snapshot',
    );

    await connect(client);

    const snapshot = await snapshotPromise;

    expect(snapshot.timeMs).toBe(1000);
    expect(snapshot.alerts).toHaveLength(1);

    expect(
      snapshot.alerts[0].civilianVehicleId,
    ).toBe('CAR-001');
  });

  it('resets the simulation and clears all alerts', async () => {
    simulation.advance(1000);

    expect(
      state.snapshotForDriver('CAR-001')?.alerts,
    ).toHaveLength(1);

    const client = createClient(
      access.issueDriverToken('CAR-001'),
    );

    await connect(client);

    const resetPromise = nextEvent<DriverSnapshot>(
      client,
      'simulation:reset',
    );

    simulation.reset();

    const snapshot = await resetPromise;

    expect(snapshot.timeMs).toBe(0);
    expect(snapshot.alerts).toEqual([]);

    expect(
      state.snapshotForDriver('CAR-001')?.alerts,
    ).toEqual([]);
  });

  it('protects HTTP demo controls with the operator key', async () => {
    const body = JSON.stringify({
      driverId: 'CAR-002',
    });

    const denied = await fetch(
      `${baseUrl}/demo/sessions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      },
    );

    expect(denied.status).toBe(401);

    const allowed = await fetch(
      `${baseUrl}/demo/sessions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-demo-operator-key': OPERATOR_KEY,
        },
        body,
      },
    );

    expect(allowed.status).toBe(201);

    const session = await allowed.json() as {
      driverId: string;
      token: string;
    };

    expect(session.driverId).toBe('CAR-002');

    expect(
      access.resolveDriver(session.token),
    ).toBe('CAR-002');

    const advance = await fetch(
      `${baseUrl}/demo/advance`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-demo-operator-key': OPERATOR_KEY,
        },
        body: JSON.stringify({
          deltaMs: 1000,
        }),
      },
    );

    expect(advance.status).toBe(201);

    const result = await advance.json() as {
      timeMs: number;
      encounterCount: number;
    };

    expect(result.timeMs).toBe(1000);
    expect(result.encounterCount).toBe(1);
  });

  it('rejects invalid simulation time steps', () => {
    expect(() =>
      simulation.advance(0),
    ).toThrow();

    expect(() =>
      simulation.advance(-1000),
    ).toThrow();

    expect(() =>
      simulation.advance(Infinity),
    ).toThrow();
  });
});
