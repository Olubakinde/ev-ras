
import {
    BadRequestException,
    Injectable,
  } from '@nestjs/common';

  import {
    detectEncounters,
    type VehicleJourney,
  } from '../detection/domain/encounter-detector.js';

  import {
    createRoadNetwork,
  } from '../simulation/domain/road-network.js';

  import {
    advanceSimulation,
    createSimulation,
    type SimulationState,
  } from '../simulation/domain/simulation.js';

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
    private readonly network = createRoadNetwork([
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

    constructor(
      private readonly state: DemoStateService,
      private readonly gateway: DriversGateway,
    ) {
      this.simulation = this.createInitialSimulation();
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
          'Demo scenario has no emergency vehicle',
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

    reset() {
      this.simulation = this.createInitialSimulation();

      this.state.initialize(this.simulation);
      this.gateway.publishReset();

      return this.state.getOperatorSnapshot();
    }
  }
