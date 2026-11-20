
import {
    createVehicle,
    type VehicleState,
  } from '../../vehicles/domain/vehicle.js';

  import {
    distanceMeters,
    getRoad,
    pointOnRoad,
    roadLengthMeters,
    type RoadNetwork,
  } from './road-network.js';

  export interface VehiclePlan {
    readonly vehicle: VehicleState;
    readonly route: readonly string[];
  }

  export interface SimulatedVehicle {
    readonly vehicle: VehicleState;
    readonly route: readonly string[];
    readonly segmentIndex: number;
    readonly distanceOnSegmentM: number;
    readonly finished: boolean;
  }

  export interface SimulationState {
    readonly timeMs: number;
    readonly vehicles: readonly SimulatedVehicle[];
  }

  const CONNECT_TOLERANCE_M = 0.5;

  /**
   * Creates a simulation with validated vehicle routes.
   *
   * Routes must use connected, directed road segments.
   * Vehicles begin at the start of their first segment.
   */
  export function createSimulation(
    network: RoadNetwork,
    startTimeMs: number,
    plans: readonly VehiclePlan[],
  ): SimulationState {
    if (
      !Number.isFinite(startTimeMs) ||
      startTimeMs < 0
    ) {
      throw new RangeError(
        'Simulation start time must be finite and nonnegative',
      );
    }

    const ids = new Set<string>();

    const vehicles = plans.map(({ vehicle, route }) => {
      const valid = createVehicle(vehicle);

      if (valid.timestampMs !== startTimeMs) {
        throw new Error(
          `Vehicle ${valid.id} timestamp must match simulation time`,
        );
      }

      if (ids.has(valid.id)) {
        throw new Error(`Duplicate vehicle: ${valid.id}`);
      }

      ids.add(valid.id);

      if (route.length === 0) {
        throw new Error(
          `Vehicle ${valid.id} needs a route`,
        );
      }

      // Validate that every segment exists and connects
      // to the previous directed segment.
      for (let i = 0; i < route.length; i++) {
        const current = getRoad(network, route[i]);

        if (i > 0) {
          const previous = getRoad(
            network,
            route[i - 1],
          );

          const previousEnd =
            previous.points[previous.points.length - 1];

          if (
            distanceMeters(
              previousEnd,
              current.points[0],
            ) > CONNECT_TOLERANCE_M
          ) {
            throw new Error(
              `Disconnected route for vehicle ${valid.id}`,
            );
          }
        }
      }

      const start = getRoad(
        network,
        route[0],
      ).points[0];

      if (
        distanceMeters(valid.position, start) >
        CONNECT_TOLERANCE_M
      ) {
        throw new Error(
          `Vehicle ${valid.id} must start at the beginning of its route`,
        );
      }

      return {
        vehicle: {
          ...valid,
          position: { ...start },
        },
        route: [...route],
        segmentIndex: 0,
        distanceOnSegmentM: 0,
        finished: false,
      } satisfies SimulatedVehicle;
    });

    return {
      timeMs: startTimeMs,
      vehicles,
    };
  }

  /**
   * Advances every vehicle using the same simulation clock.
   *
   * This function is deterministic and does not mutate
   * the previous simulation state.
   */
  export function advanceSimulation(
    network: RoadNetwork,
    simulation: SimulationState,
    deltaMs: number,
  ): SimulationState {
    if (
      !Number.isFinite(deltaMs) ||
      deltaMs < 0
    ) {
      throw new RangeError(
        'Time step must be finite and nonnegative',
      );
    }

    const nextTimeMs = simulation.timeMs + deltaMs;

    if (!Number.isFinite(nextTimeMs)) {
      throw new RangeError('Simulation time overflow');
    }

    return {
      timeMs: nextTimeMs,

      vehicles: simulation.vehicles.map(
        (entry): SimulatedVehicle => {
          const { vehicle, route } = entry;

          let index = entry.segmentIndex;
          let progress = entry.distanceOnSegmentM;
          let finished = entry.finished;

          // Distance = speed × elapsed time.
          let remaining =
            vehicle.speedMps * (deltaMs / 1000);

          if (!Number.isFinite(remaining)) {
            throw new RangeError(
              'Travel distance overflow',
            );
          }

          // Advance through as many road segments as needed.
          while (remaining > 0 && !finished) {
            const road = getRoad(
              network,
              route[index],
            );

            const available = Math.max(
              0,
              roadLengthMeters(road) - progress,
            );

            if (remaining < available) {
              progress += remaining;
              remaining = 0;
            } else {
              remaining -= available;
              index += 1;
              progress = 0;

              finished = index === route.length;
            }
          }

          // Vehicle reached the end of its entire route.
          if (finished) {
            const last = getRoad(
              network,
              route[route.length - 1],
            );

            const end = pointOnRoad(
              last,
              roadLengthMeters(last),
            );

            return {
              vehicle: createVehicle({
                ...vehicle,
                ...end,
                speedMps: 0,
                timestampMs: nextTimeMs,
              }),
              route: [...route],
              segmentIndex: index,
              distanceOnSegmentM: 0,
              finished: true,
            };
          }

          // Sample the current road geometry if movement occurred.
          const sample =
            remaining === 0 &&
            vehicle.speedMps > 0 &&
            deltaMs > 0
              ? pointOnRoad(
                  getRoad(network, route[index]),
                  progress,
                )
              : {
                  position: { ...vehicle.position },
                  headingDeg: vehicle.headingDeg,
                };

          return {
            vehicle: createVehicle({
              ...vehicle,
              ...sample,
              timestampMs: nextTimeMs,
            }),
            route: [...route],
            segmentIndex: index,
            distanceOnSegmentM: progress,
            finished: false,
          };
        },
      ),
    };
  }
