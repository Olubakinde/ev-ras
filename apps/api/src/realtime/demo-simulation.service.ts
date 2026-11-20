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

import { selectAlertableEncounters } from '../detection/domain/road-aware-encounters.js';

import type {
  VehicleRoadTopology,
} from '../detection/domain/road-topology.js';

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
  advanceMixedTraffic,
  buildMixedTrafficScenario,
  DEFAULT_TRAFFIC_SEED,
  TRAFFIC_CAR_COUNT,
  type MixedTrafficScenario,
} from '../simulation/domain/mixed-traffic.js';

import {
  advanceSimulation,
  createSimulation,
  type SimulationState,
} from '../simulation/domain/simulation.js';

import type {
  RoadScenarioVehicleRequest,
} from './road-scenario-request.js';

import { DemoStateService } from './demo-state.service.js';
import { NEWARK_TRAFFIC_ROUTES } from './traffic-presets.js';
import { DriversGateway } from './drivers.gateway.js';

const A = { latitude: 39.683, longitude: -75.751 };
const B = { latitude: 39.683, longitude: -75.75 };
const C = { latitude: 39.683, longitude: -75.749 };
const SOUTH = { latitude: 39.682, longitude: -75.75 };
const NORTH = { latitude: 39.684, longitude: -75.75 };
const PARALLEL_START = { latitude: 39.6833, longitude: -75.751 };
const PARALLEL_END = { latitude: 39.6833, longitude: -75.749 };

@Injectable()
export class DemoSimulationService {
  private readonly logger = new Logger(DemoSimulationService.name);

  private network: RoadNetwork = createRoadNetwork([
    { id: 'AMB_ROUTE', points: [A, B, C] },
    { id: 'CAR_CROSS', points: [SOUTH, B, NORTH] },
    { id: 'CAR_PARALLEL', points: [PARALLEL_START, PARALLEL_END] },
  ]);

  private simulation: SimulationState;
  private initialSimulation: SimulationState;
  private source: 'DEMO' | 'OSRM' = 'DEMO';
  private routes: readonly ScenarioRoute[] = [];
  private topologies: readonly VehicleRoadTopology[] = [];
  private loading = false;
  private traffic: MixedTrafficScenario | null = null;

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
    const topologyStatus =
      this.source === 'DEMO'
        ? 'DEMO_GEOMETRIC'
        : this.topologies.every((route) => route.nodes.length > 0)
          ? 'OSM_NODE_EVIDENCE'
          : 'UNAVAILABLE';

    return {
      source: this.source,
      routes: this.routes,
      topologyStatus,
    };
  }

  /**
   * Construct the entire OSRM scenario before replacing the running scene.
   * A failed network request does not clear existing driver alerts.
   */
  async loadRoadScenario(
    vehicles: readonly RoadScenarioVehicleRequest[],
  ) {
    if (this.loading) {
      throw new ConflictException('A road scenario is already loading');
    }

    this.loading = true;
    let nextScenario: RoadScenario;

    try {
      const routed: RoutedVehicle[] = await Promise.all(
        vehicles.map(async (vehicle): Promise<RoutedVehicle> => {
          const route = await this.osrm.getDrivingRoute(
            vehicle.origin,
            vehicle.destination,
            vehicle.id,
          );

          return {
            id: vehicle.id,
            kind: vehicle.id === 'AMB-001' ? 'EMERGENCY' : 'CIVILIAN',
            speedMps: vehicle.speedMps,
            route,
          };
        }),
      );

      nextScenario = buildRoadScenario(routed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not load OSRM scenario: ${message}`);

      throw new BadGatewayException(
        'Could not initialize the road scenario from routing data',
      );
    } finally {
      this.loading = false;
    }

    this.network = nextScenario.network;
    this.initialSimulation = nextScenario.simulation;
    this.simulation = nextScenario.simulation;
    this.source = 'OSRM';
    this.routes = nextScenario.routes;
    this.topologies = nextScenario.topologies;
    this.traffic = null;

    this.state.initialize(this.simulation);
    this.gateway.publishReset();

    return {
      ...this.getRouteMetadata(),
      snapshot: this.state.getOperatorSnapshot(),
    };
  }

  /** Metadata for the separately enabled 25-car demo traffic mode. */
  getTrafficMetadata() {
    return {
      active: this.traffic !== null,
      mode: this.traffic ? 'MIXED' : null,
      seed: this.traffic?.seed ?? null,
      civilianCount: this.traffic ? TRAFFIC_CAR_COUNT : 0,
      routeTemplateCount: this.traffic ? 5 : 0,
      encounterEvaluation: this.traffic ? 'TOPOLOGY_FILTERED' : null,
    };
  }

  /**
   * Load six real road routes once, then build 25 deterministically placed
   * synthetic civilian vehicles. Any OSRM failure preserves the old scene.
   *
   * Each car is subsequently evaluated independently using topology evidence.
   */
  async loadMixedTrafficScenario(seed = DEFAULT_TRAFFIC_SEED) {
    if (this.loading) {
      throw new ConflictException('A road scenario is already loading');
    }
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 4_294_967_295) {
      throw new BadRequestException('seed must be a 32-bit unsigned integer');
    }

    this.loading = true;
    let scenario: MixedTrafficScenario;
    try {
      // Sequential queries keep requests bounded on the public OSRM demo.
      const routes = [];
      for (const preset of NEWARK_TRAFFIC_ROUTES) {
        routes.push(
          await this.osrm.getDrivingRoute(preset.origin, preset.destination, preset.id),
        );
      }
      scenario = buildMixedTrafficScenario(routes[0], routes.slice(1), seed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not load mixed traffic: ${message}`);
      throw new BadGatewayException('Could not initialize the traffic scenario');
    } finally {
      this.loading = false;
    }

    this.network = scenario.network;
    this.initialSimulation = scenario.initialSimulation;
    this.simulation = scenario.initialSimulation;
    this.routes = scenario.routes;
    this.topologies = scenario.topologies;
    this.source = 'OSRM';
    this.traffic = scenario;
    this.state.initialize(this.simulation);
    this.gateway.publishReset();

    return {
      ...this.getTrafficMetadata(),
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

    const next = this.traffic
      ? advanceMixedTraffic(
          this.network,
          this.simulation,
          deltaMs,
          this.traffic.profiles,
        )
      : advanceSimulation(this.network, this.simulation, deltaMs);

    const emergency = next.vehicles.find(
      (entry) => entry.vehicle.kind === 'EMERGENCY',
    );

    if (!emergency) {
      throw new Error('Scenario has no emergency vehicle');
    }

    const civilians: VehicleJourney[] = next.vehicles
      .filter((entry) => entry.vehicle.kind === 'CIVILIAN')
      .map((entry) => ({ network: this.network, state: entry }));

    // Every civilian is evaluated independently, including all 25 traffic cars.
    // OSRM mode fails closed: geometric proximity is insufficient without
    // compatible OSM node or shared-edge evidence at the conflict location.
    const geometricCandidates = detectEncounters(
      { network: this.network, state: emergency },
      civilians,
    );
    const encounters = selectAlertableEncounters(
      geometricCandidates,
      this.source,
      this.topologies,
    );

    const events = this.state.update(next, encounters);
    this.simulation = next;

    this.gateway.publishAlertEvents(events);
    this.gateway.publishTick();

    return {
      timeMs: next.timeMs,
      encounterCount: encounters.length,
      suppressedCandidateCount: geometricCandidates.length - encounters.length,
      ...(this.traffic ? { encounterEvaluation: 'TOPOLOGY_FILTERED' } : {}),
      events,
      snapshot: this.state.getOperatorSnapshot(),
    };
  }

  /** Rewind the active scenario, preserving its routing mode and topology. */
  reset() {
    this.simulation = this.initialSimulation;
    this.state.initialize(this.simulation);
    this.gateway.publishReset();
    return this.state.getOperatorSnapshot();
  }
}
