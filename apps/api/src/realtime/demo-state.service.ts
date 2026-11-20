
import { Injectable } from '@nestjs/common';

import {
  reconcileAlerts,
  type AlertEvent,
  type DriverAlert,
} from '../alerts/domain/alert-manager.js';

import type {
  EncounterCandidate,
} from '../detection/domain/encounter-detector.js';

import type {
  SimulationState,
} from '../simulation/domain/simulation.js';

import type {
  VehicleState,
} from '../vehicles/domain/vehicle.js';

export interface DriverSnapshot {
  readonly timeMs: number;
  readonly driver: VehicleState;
  readonly emergencyVehicles: readonly VehicleState[];
  readonly alerts: readonly DriverAlert[];
}

function copyVehicle(vehicle: VehicleState): VehicleState {
  return {
    ...vehicle,
    position: { ...vehicle.position },
  };
}

function copyAlert(alert: DriverAlert): DriverAlert {
  return {
    ...alert,
    location: { ...alert.location },
  };
}

@Injectable()
export class DemoStateService {
  private simulation: SimulationState | null = null;
  private alerts: readonly DriverAlert[] = [];

  initialize(simulation: SimulationState): void {
    this.simulation = simulation;
    this.alerts = [];
  }

  update(
    simulation: SimulationState,
    candidates: readonly EncounterCandidate[],
  ): readonly AlertEvent[] {
    const result = reconcileAlerts(
      this.alerts,
      candidates,
      simulation.timeMs,
    );

    this.simulation = simulation;
    this.alerts = result.active;

    return result.events;
  }

  snapshotForDriver(
    driverId: string,
  ): DriverSnapshot | null {
    if (!this.simulation) {
      return null;
    }

    const entry = this.simulation.vehicles.find(
      (item) =>
        item.vehicle.id === driverId &&
        item.vehicle.kind === 'CIVILIAN',
    );

    if (!entry) {
      return null;
    }

    return {
      timeMs: this.simulation.timeMs,
      driver: copyVehicle(entry.vehicle),
      emergencyVehicles: this.simulation.vehicles
        .filter(
          (item) => item.vehicle.kind === 'EMERGENCY',
        )
        .map((item) => copyVehicle(item.vehicle)),
      alerts: this.alerts
        .filter(
          (alert) =>
            alert.civilianVehicleId === driverId,
        )
        .map(copyAlert),
    };
  }

  getOperatorSnapshot() {
    if (!this.simulation) {
      return {
        timeMs: 0,
        vehicles: [],
        alerts: [],
      };
    }

    return {
      timeMs: this.simulation.timeMs,
      vehicles: this.simulation.vehicles.map(
        (entry) => ({
          ...copyVehicle(entry.vehicle),
          finished: entry.finished,
        }),
      ),
      alerts: this.alerts.map(copyAlert),
    };
  }
}
