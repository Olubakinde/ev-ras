
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
  } from 'vitest';

  import type { INestApplication } from '@nestjs/common';
  import { Test } from '@nestjs/testing';

  import type { Server } from 'node:http';
  import type { AddressInfo } from 'node:net';

  import {
    io,
    type Socket as ClientSocket,
  } from 'socket.io-client';

  import {
    createRoadNetwork,
    distanceMeters,
  } from '../simulation/domain/road-network.js';

  import {
    OsrmClient,
    type DrivingRoute,
  } from '../routing/osrm-client.js';

  import type {
    GeoPosition,
  } from '../vehicles/domain/vehicle.js';

  import { DemoAccessService } from './demo-access.service.js';
  import { DemoSimulationService } from './demo-simulation.service.js';
  import { DemoStateService } from './demo-state.service.js';

  import {
    parseRoadScenarioRequest,
  } from './road-scenario-request.js';

  import { RealtimeModule } from './realtime.module.js';

  const KEY = 'test-road-scenario-operator-2026';
  const oldKey = process.env.EVRAS_DEMO_OPERATOR_KEY;

  const A = {
    latitude: 39.683,
    longitude: -75.751,
  };

  const B = {
    latitude: 39.683,
    longitude: -75.75,
  };

  const C = {
    latitude: 39.683,
    longitude: -75.749,
  };

  const SOUTH = {
    latitude: 39.682,
    longitude: -75.75,
  };

  const NORTH = {
    latitude: 39.684,
    longitude: -75.75,
  };

  const PARALLEL_START = {
    latitude: 39.6833,
    longitude: -75.751,
  };

  const PARALLEL_END = {
    latitude: 39.6833,
    longitude: -75.749,
  };

  function requestBody() {
    return {
      vehicles: [
        {
          id: 'AMB-001',
          origin: A,
          destination: C,
          speedMps: 15,
        },
        {
          id: 'CAR-001',
          origin: SOUTH,
          destination: NORTH,
          speedMps: 20,
        },
      ],
    };
  }

  function makeRoute(
    id: string,
    points: readonly GeoPosition[],
  ): DrivingRoute {
    const segments = points.slice(1).map(
      (point, index) => ({
        id: `${id}:${index}`,
        points: [
          points[index],
          point,
        ],
      }),
    );

    const distance = segments.reduce(
      (total, segment) =>
        total +
        distanceMeters(
          segment.points[0],
          segment.points[1],
        ),
      0,
    );

    return {
      distanceMeters: distance,
      durationSeconds: distance / 12,
      coordinates: points.map(
        (point) =>
          [
            point.longitude,
            point.latitude,
          ] as const,
      ),
      roadNetwork: createRoadNetwork(segments),
      segmentIds: segments.map(
        (segment) => segment.id,
      ),
      snappedStart: { ...points[0] },
      topologyNodes: points.map((point, index) => ({
        id: point.latitude === B.latitude && point.longitude === B.longitude
          ? '102'
          : String((id === 'AMB-001' ? 1000 : id === 'CAR-001' ? 2000 : 3000) + index + 1),
        position: { ...point },
      })),
      snappedEnd: {
        ...points[points.length - 1],
      },
    };
  }

  async function fakeRoute(
    _origin: GeoPosition,
    _destination: GeoPosition,
    routeId: string,
  ): Promise<DrivingRoute> {
    switch (routeId) {
      case 'AMB-001':
        return makeRoute(routeId, [A, B, C]);

      case 'CAR-001':
        return makeRoute(
          routeId,
          [SOUTH, B, NORTH],
        );

      case 'CAR-002':
        return makeRoute(
          routeId,
          [PARALLEL_START, PARALLEL_END],
        );

      default:
        throw new Error('Unknown mock route');
    }
  }

  describe('road scenario request validation', () => {
    it('accepts two correctly formed vehicles', () => {
      const result = parseRoadScenarioRequest(
        requestBody(),
      );

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('AMB-001');
      expect(result[1].id).toBe('CAR-001');
      expect(result[0].origin).toEqual(A);
    });

    it('accepts an optional second civilian', () => {
      const body = requestBody();

      const result = parseRoadScenarioRequest({
        vehicles: [
          ...body.vehicles,
          {
            id: 'CAR-002',
            origin: PARALLEL_START,
            destination: PARALLEL_END,
            speedMps: 15,
          },
        ],
      });

      expect(result).toHaveLength(3);
    });

    it('rejects duplicate and unknown driver IDs', () => {
      const body = requestBody();

      expect(() =>
        parseRoadScenarioRequest({
          vehicles: [
            body.vehicles[0],
            body.vehicles[0],
          ],
        }),
      ).toThrow();

      expect(() =>
        parseRoadScenarioRequest({
          vehicles: [
            body.vehicles[0],
            {
              ...body.vehicles[1],
              id: 'CAR-999',
            },
          ],
        }),
      ).toThrow();
    });

    it('rejects invalid coordinates and speeds', () => {
      const body = requestBody();

      expect(() =>
        parseRoadScenarioRequest({
          vehicles: [
            {
              ...body.vehicles[0],
              origin: {
                latitude: 120,
                longitude: -75,
              },
            },
            body.vehicles[1],
          ],
        }),
      ).toThrow();

      expect(() =>
        parseRoadScenarioRequest({
          vehicles: [
            body.vehicles[0],
            {
              ...body.vehicles[1],
              speedMps: Infinity,
            },
          ],
        }),
      ).toThrow();

      expect(() =>
        parseRoadScenarioRequest({
          vehicles: [
            {
              ...body.vehicles[0],
              speedMps: 0,
            },
            body.vehicles[1],
          ],
        }),
      ).toThrow();
    });
  });

  describe('real-road scenario integration', () => {
    let app: INestApplication;
    let baseUrl: string;

    let access: DemoAccessService;
    let simulation: DemoSimulationService;
    let state: DemoStateService;

    let getRoute = vi.fn(fakeRoute);

    const clients: ClientSocket[] = [];

    async function post(
      path: string,
      body: unknown,
      key: string | null = KEY,
    ): Promise<Response> {
      return fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key === null
            ? {}
            : { 'x-demo-operator-key': key }),
        },
        body: JSON.stringify(body),
      });
    }

    function nextEvent<T>(
      client: ClientSocket,
      eventName: string,
    ): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(
            new Error(
              `Timed out waiting for ${eventName}`,
            ),
          );
        }, 5000);

        client.once(eventName, (payload: T) => {
          clearTimeout(timeout);
          resolve(payload);
        });
      });
    }

    async function connectDriver(
      driverId: string,
    ): Promise<ClientSocket> {
      const token = access.issueDriverToken(driverId);

      const client = io(`${baseUrl}/drivers`, {
        auth: { token },
        transports: ['websocket'],
        autoConnect: false,
        reconnection: false,
        timeout: 5000,
      });

      clients.push(client);

      const connected = new Promise<void>(
        (resolve, reject) => {
          client.once('connect', resolve);
          client.once('connect_error', reject);
        },
      );

      client.connect();
      await connected;

      return client;
    }

    beforeEach(async () => {
      process.env.EVRAS_DEMO_OPERATOR_KEY = KEY;

      getRoute = vi.fn(fakeRoute);

      const moduleRef = await Test.createTestingModule({
        imports: [RealtimeModule],
      })
        .overrideProvider(OsrmClient)
        .useValue({
          getDrivingRoute: getRoute,
        })
        .compile();

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

      if (oldKey === undefined) {
        delete process.env.EVRAS_DEMO_OPERATOR_KEY;
      } else {
        process.env.EVRAS_DEMO_OPERATOR_KEY = oldKey;
      }
    });

    it('rejects requests without operator authentication', async () => {
      const result = await post(
        '/demo/route-scenario',
        requestBody(),
        null,
      );

      expect(result.status).toBe(401);
      expect(getRoute).not.toHaveBeenCalled();
    });

    it('rejects malformed requests before calling OSRM', async () => {
      const result = await post(
        '/demo/route-scenario',
        {
          vehicles: [
            {
              id: 'AMB-001',
              speedMps: -5,
            },
          ],
        },
      );

      expect(result.status).toBe(400);
      expect(getRoute).not.toHaveBeenCalled();
    });

    it('loads two OSRM routes into a new simulation', async () => {
      const response = await post(
        '/demo/route-scenario',
        requestBody(),
      );

      expect(response.status).toBe(201);

      const result = await response.json() as {
        source: string;
        routes: Array<{
          vehicleId: string;
          coordinates: number[][];
        }>;
        snapshot: {
          timeMs: number;
          vehicles: Array<{ id: string }>;
          alerts: unknown[];
        };
      };

      expect(result.source).toBe('OSRM');

      expect(result.routes).toHaveLength(2);

      expect(result.routes[0].coordinates).toEqual([
        [-75.751, 39.683],
        [-75.75, 39.683],
        [-75.749, 39.683],
      ]);

      expect(result.snapshot.timeMs).toBe(0);
      expect(result.snapshot.vehicles).toHaveLength(2);
      expect(result.snapshot.alerts).toEqual([]);

      expect(getRoute).toHaveBeenCalledWith(
        A,
        C,
        'AMB-001',
      );

      expect(getRoute).toHaveBeenCalledWith(
        SOUTH,
        NORTH,
        'CAR-001',
      );

      expect(
        state.snapshotForDriver('CAR-002'),
      ).toBeNull();
    });

    it('suppresses an OSRM crossing without topology evidence', async () => {
      getRoute.mockImplementationOnce(async (origin, destination, routeId) => {
        const route = await fakeRoute(origin, destination, routeId);
        return { ...route, topologyNodes: undefined };
      });
    
      const response = await post('/demo/route-scenario', requestBody());
      expect(response.status).toBe(201);
      const result = simulation.advance(1000);
      expect(result.encounterCount).toBe(0);
      expect(result.suppressedCandidateCount).toBe(1);
      expect(result.events).toEqual([]);
    });
    
    it('advances vehicles on the newly loaded road network', async () => {
      const response = await post(
        '/demo/route-scenario',
        requestBody(),
      );

      expect(response.status).toBe(201);

      const result = simulation.advance(1000);

      expect(result.timeMs).toBe(1000);
      expect(result.encounterCount).toBe(1);

      expect(
        result.events[0].type,
      ).toBe('CREATED');

      expect(
        result.events[0].alert.civilianVehicleId,
      ).toBe('CAR-001');

      expect(
        state.snapshotForDriver('CAR-001')?.alerts,
      ).toHaveLength(1);
    });

    it('delivers the real-road scenario warning through Socket.IO', async () => {
      const client = await connectDriver('CAR-001');

      const resetPromise = nextEvent<{
        timeMs: number;
        driver: { id: string };
        alerts: unknown[];
      }>(client, 'simulation:reset');

      const response = await post(
        '/demo/route-scenario',
        requestBody(),
      );

      expect(response.status).toBe(201);

      const reset = await resetPromise;

      expect(reset.timeMs).toBe(0);
      expect(reset.driver.id).toBe('CAR-001');
      expect(reset.alerts).toEqual([]);

      const alertPromise = nextEvent<{
        emergencyVehicleId: string;
        civilianVehicleId: string;
        classification: string;
      }>(client, 'alert:created');

      simulation.advance(1000);

      const alert = await alertPromise;

      expect(alert.emergencyVehicleId).toBe(
        'AMB-001',
      );

      expect(alert.civilianVehicleId).toBe(
        'CAR-001',
      );

      expect(alert.classification).toBe(
        'UNVERIFIED_ROUTE_ENCOUNTER',
      );
    });

    it('notifies a driver excluded from the new scenario', async () => {
      const client = await connectDriver('CAR-002');

      const unavailablePromise = nextEvent<{
        driverId: string;
      }>(client, 'simulation:unavailable');

      const response = await post(
        '/demo/route-scenario',
        requestBody(),
      );

      expect(response.status).toBe(201);

      const message = await unavailablePromise;

      expect(message.driverId).toBe('CAR-002');

      expect(
        state.snapshotForDriver('CAR-002'),
      ).toBeNull();
    });

    it('preserves the previous state when OSRM fails', async () => {
      simulation.advance(1000);

      const previous =
        state.getOperatorSnapshot();

      getRoute.mockRejectedValueOnce(
        new Error('Routing server unavailable'),
      );

      const response = await post(
        '/demo/route-scenario',
        requestBody(),
      );

      expect(response.status).toBe(502);

      expect(
        state.getOperatorSnapshot(),
      ).toEqual(previous);

      expect(
        simulation.getRouteMetadata().source,
      ).toBe('DEMO');
    });

    it('rejects unusable routing geometry without changing state', async () => {
      const before = state.getOperatorSnapshot();

      getRoute.mockResolvedValueOnce({
        ...makeRoute('AMB-001', [A, B, C]),
        distanceMeters: 30_000,
      });

      const response = await post(
        '/demo/route-scenario',
        requestBody(),
      );

      expect(response.status).toBe(502);

      expect(
        state.getOperatorSnapshot(),
      ).toEqual(before);
    });

    it('reset rewinds the active OSRM scenario', async () => {
      const loaded = await post(
        '/demo/route-scenario',
        requestBody(),
      );

      expect(loaded.status).toBe(201);

      simulation.advance(1000);

      const reset = await post(
        '/demo/reset',
        {},
      );

      expect(reset.status).toBe(201);

      const snapshot = await reset.json() as {
        timeMs: number;
        vehicles: unknown[];
        alerts: unknown[];
      };

      expect(snapshot.timeMs).toBe(0);
      expect(snapshot.vehicles).toHaveLength(2);
      expect(snapshot.alerts).toEqual([]);

      expect(
        simulation.getRouteMetadata().source,
      ).toBe('OSRM');
    });

    it('exposes active route geometry to authenticated operators', async () => {
      const loaded = await post(
        '/demo/route-scenario',
        requestBody(),
      );

      expect(loaded.status).toBe(201);

      const denied = await fetch(
        `${baseUrl}/demo/routes`,
      );

      expect(denied.status).toBe(401);

      const response = await fetch(
        `${baseUrl}/demo/routes`,
        {
          headers: {
            'x-demo-operator-key': KEY,
          },
        },
      );

      expect(response.status).toBe(200);

      const result = await response.json() as {
        source: string;
        routes: Array<{ vehicleId: string }>;
      };

      expect(result.source).toBe('OSRM');
      expect(
        result.routes.map((route) => route.vehicleId),
      ).toEqual(['AMB-001', 'CAR-001']);
    });
  });
