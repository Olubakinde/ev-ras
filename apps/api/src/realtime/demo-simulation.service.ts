
import {
    BadGatewayException,
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
  } from '@nestjs/common';

  import {
    detectEncounters,
    type VehicleJourney,
  } from '../detection/domain/encounter-detector.js';

  import { OsrmClient } from '../routing/osrm-client.js';

  import {
    buildRoadScenario,
    type RoadScenario,
    type RoutedVehicle,
    type ScenarioRoute,
  } from '../routing/route-scenario.js';

  import {
    createRoadNetwork,
    type RoadNetwork,
  } from '../simulation/domain/road-network.js';

  import {
    advanceSimulation,
    createSimulation,
    type SimulationState,
  } from '../simulation/domain/simulation.js';

  import type {
    RoadScenarioVehicleRequest,
  } from './road-scenario-request.js';

  import { DemoStateService } from './demo-state.service.js';
  import { DriversGateway } from './drivers.gateway.js';

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

  @Injectable()
  export class DemoSimulationService {
    private readonly logger = new Logger(
      DemoSimulationService.name,
    );

    private network: RoadNetwork = createRoadNetwork([
      {
        id: 'AMB_ROUTE',
        points: [A, B, C],
      },
      {
        id: 'CAR_CROSS',
        points: [SOUTH, B, NORTH],
      },
      {
        id: 'CAR_PARALLEL',
        points: [PARALLEL_START, PARALLEL_END],
      },
    ]);

    private simulation: SimulationState;
    private initialSimulation: SimulationState;

    private source: 'DEMO' | 'OSRM' = 'DEMO';
    private routes: readonly ScenarioRoute[] = [];

    private loading = false;

    constructor(
      private readonly state: DemoStateService,
      private readonly gateway: DriversGateway,
      private readonly osrm: OsrmClient,
    ) {
      this.simulation = this.createInitialSimulation();
      this.initialSimulation = this.simulation;

      this.state.initialize(this.simulation);
    }

    private createInitialSimulation(): SimulationState {
      return createSimulation(this.network, 0, [
        {
          vehicle: {
            id: 'AMB-001',
            kind: 'EMERGENCY',
            position: A,
            speedMps: 15,
            headingDeg: 90,
            timestampMs: 0,
          },
          route: ['AMB_ROUTE'],
        },
        {
          vehicle: {
            id: 'CAR-001',
            kind: 'CIVILIAN',
            position: SOUTH,
            speedMps: 20,
            headingDeg: 0,
            timestampMs: 0,
          },
          route: ['CAR_CROSS'],
        },
        {
          vehicle: {
            id: 'CAR-002',
            kind: 'CIVILIAN',
            position: PARALLEL_START,
            speedMps: 15,
            headingDeg: 90,
            timestampMs: 0,
          },
          route: ['CAR_PARALLEL'],
        },
      ]);
    }

    getRouteMetadata() {
      return {
        source: this.source,
        routes: this.routes,
      };
    }

    /**
     * Fetch and validate all routes before changing
     * any active simulation state.
     *
     * Failure leaves the previous simulation and
     * its active alerts untouched.
     */
    async loadRoadScenario(
      vehicles: readonly RoadScenarioVehicleRequest[],
    ) {
      if (this.loading) {
        throw new ConflictException(
          'A road scenario is already loading',
        );
      }

      this.loading = true;

      let nextScenario: RoadScenario;

      try {
        const routed: RoutedVehicle[] = await Promise.all(
          vehicles.map(
            async (vehicle): Promise<RoutedVehicle> => {
              const route =
                await this.osrm.getDrivingRoute(
                  vehicle.origin,
                  vehicle.destination,
                  vehicle.id,
                );

              return {
                id: vehicle.id,
                kind:
                  vehicle.id === 'AMB-001'
                    ? 'EMERGENCY'
                    : 'CIVILIAN',
                speedMps: vehicle.speedMps,
                route,
              };
            },
          ),
        );

        nextScenario = buildRoadScenario(routed);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        this.logger.warn(
          `Could not load OSRM scenario: ${message}`,
        );

        throw new BadGatewayException(
          'Could not initialize the road scenario from routing data',
        );
      } finally {
        this.loading = false;
      }

      // Commit the new scenario only after every
      // route and simulation plan has been validated.
      this.network = nextScenario.network;
      this.initialSimulation = nextScenario.simulation;
      this.simulation = nextScenario.simulation;

      this.source = 'OSRM';
      this.routes = nextScenario.routes;

      this.state.initialize(this.simulation);

      // Connected clients discard their old scene.
      this.gateway.publishReset();

      return {
        ...this.getRouteMetadata(),
        snapshot: this.state.getOperatorSnapshot(),
      };
    }

    advance(deltaMs: number) {
      if (
        !Number.isSafeInteger(deltaMs) ||
        deltaMs <= 0 ||
        deltaMs > 60_000
      ) {
        throw new BadRequestException(
          'deltaMs must be an integer between 1 and 60000',
        );
      }

      const next = advanceSimulation(
        this.network,
        this.simulation,
        deltaMs,
      );

      const emergency = next.vehicles.find(
        (entry) =>
          entry.vehicle.kind === 'EMERGENCY',
      );

      if (!emergency) {
        throw new Error(
          'Scenario has no emergency vehicle',
        );
      }

      const civilians: VehicleJourney[] =
        next.vehicles
          .filter(
            (entry) =>
              entry.vehicle.kind === 'CIVILIAN',
          )
          .map((entry) => ({
            network: this.network,
            state: entry,
          }));

      const encounters = detectEncounters(
        {
          network: this.network,
          state: emergency,
        },
        civilians,
      );

      const events = this.state.update(
        next,
        encounters,
      );

      this.simulation = next;

      this.gateway.publishAlertEvents(events);
      this.gateway.publishTick();

      return {
        timeMs: next.timeMs,
        encounterCount: encounters.length,
        events,
        snapshot: this.state.getOperatorSnapshot(),
      };
    }

    /**
     * Rewind the currently loaded scenario.
     *
     * If OSRM routes are active, reset keeps those
     * routes instead of returning to the old demo.
     */
    reset() {
      this.simulation = this.initialSimulation;

      this.state.initialize(this.simulation);
      this.gateway.publishReset();

      return this.state.getOperatorSnapshot();
    }
  }
