import { describe, expect, it } from 'vitest';
import { AdaptiveEtaTracker, projectTravelSeconds } from './adaptive-eta.js';
import type { SimulationState, SimulatedVehicle } from '../../simulation/domain/simulation.js';
import type { VehicleJourney } from './encounter-detector.js';

function frame(timeMs: number, speeds: readonly [string, number][]): SimulationState {
  return {
    timeMs,
    vehicles: speeds.map(([id, speedMps]) => ({
      vehicle: { id, kind: id.startsWith('AMB') ? 'EMERGENCY' : 'CIVILIAN',
        speedMps, timestampMs: timeMs, position: { latitude: 0, longitude: 0 }, headingDeg: 0 },
      route: ['a'], segmentIndex: 0, distanceOnSegmentM: 0, finished: false,
    } satisfies SimulatedVehicle)),
  };
}
function journey(state: SimulationState, id = 'AMB-001'): VehicleJourney {
  return { state: state.vehicles.find(v => v.vehicle.id === id)!, network: {} as VehicleJourney['network'] };
}

describe('bounded adaptive ETA', () => {
  it('matches constant speed when acceleration is zero', () => {
    expect(projectTravelSeconds(100, 10)).toBe(10);
  });
  it('projects a sustained acceleration over a short horizon', () => {
    const t = projectTravelSeconds(100, 10, 2)!;
    expect(t).toBeLessThan(10);
    expect(t).toBeGreaterThan(0);
  });
  it('projects sustained braking as a longer ETA', () => {
    expect(projectTravelSeconds(100, 15, -2)!).toBeGreaterThan(100 / 15);
  });
  it('reports unknown if projected braking stops the vehicle before the target', () => {
    expect(projectTravelSeconds(200, 8, -4)).toBeNull();
  });
  it('allows reaching an intersection before stopping', () => {
    expect(projectTravelSeconds(6, 8, -4)).toBeCloseTo(1, 6);
  });
  it('does not turn a stationary vehicle into a predicted arrival', () => {
    expect(projectTravelSeconds(10, 0, 2)).toBeNull();
    expect(projectTravelSeconds(0, 0, 2)).toBe(0);
  });
  it('rejects invalid numeric input', () => {
    expect(() => projectTravelSeconds(NaN, 10)).toThrow(RangeError);
    expect(() => projectTravelSeconds(1, -2)).toThrow(RangeError);
    expect(() => projectTravelSeconds(1, 2, Infinity)).toThrow(RangeError);
  });
  it('does not extrapolate from fewer than three observations', () => {
    const tracker = new AdaptiveEtaTracker();
    tracker.observe(frame(0, [['AMB-001', 10]]));
    const state = frame(1000, [['AMB-001', 12]]);
    tracker.observe(state);
    expect(tracker.estimate(journey(state), 120)).toBe(10);
  });
  it('uses a consistent three-sample speed trend', () => {
    const tracker = new AdaptiveEtaTracker();
    tracker.observe(frame(0, [['AMB-001', 10]]));
    tracker.observe(frame(1000, [['AMB-001', 12]]));
    const state = frame(2000, [['AMB-001', 14]]);
    tracker.observe(state);
    expect(tracker.estimate(journey(state), 140)!).toBeLessThan(10);
  });
  it('rejects abrupt speed-setpoint changes as sustained acceleration', () => {
    const tracker = new AdaptiveEtaTracker();
    tracker.observe(frame(0, [['AMB-001', 5]]));
    tracker.observe(frame(1000, [['AMB-001', 15]]));
    const state = frame(2000, [['AMB-001', 25]]);
    tracker.observe(state);
    expect(tracker.estimate(journey(state), 100)).toBe(4);
  });
  it('resets trend after speed reverses direction', () => {
    const tracker = new AdaptiveEtaTracker();
    tracker.observe(frame(0, [['AMB-001', 10]]));
    tracker.observe(frame(1000, [['AMB-001', 12]]));
    const state = frame(2000, [['AMB-001', 11]]);
    tracker.observe(state);
    expect(tracker.estimate(journey(state), 110)).toBe(10);
  });
  it('resets after stale telemetry gap', () => {
    const tracker = new AdaptiveEtaTracker();
    tracker.observe(frame(0, [['AMB-001', 10]]));
    tracker.observe(frame(1000, [['AMB-001', 12]]));
    const state = frame(10000, [['AMB-001', 14]]);
    tracker.observe(state);
    expect(tracker.estimate(journey(state), 140)).toBe(10);
  });
  it('resets after clock rewind and does not share traffic across seeds', () => {
    const tracker = new AdaptiveEtaTracker();
    tracker.observe(frame(0, [['AMB-001', 10]]));
    tracker.observe(frame(1000, [['AMB-001', 12]]));
    tracker.observe(frame(2000, [['AMB-001', 14]]));
    const rewound = frame(0, [['AMB-001', 20]]);
    tracker.reset(rewound);
    expect(tracker.estimate(journey(rewound), 100)).toBe(5);
  });
  it('drops missing vehicle IDs and never applies another car’s samples', () => {
    const tracker = new AdaptiveEtaTracker();
    tracker.observe(frame(0, [['AMB-001', 10], ['CAR-001', 5]]));
    tracker.observe(frame(1000, [['AMB-001', 11], ['CAR-001', 6]]));
    const state = frame(2000, [['AMB-001', 12], ['CAR-025', 7]]);
    tracker.observe(state);
    expect(tracker.estimate(journey(state, 'CAR-025'), 70)).toBe(10);
  });
  it('does not count repeated timestamps as acceleration samples', () => {
    const tracker = new AdaptiveEtaTracker();
    tracker.observe(frame(0, [['AMB-001', 10]]));
    tracker.observe(frame(1000, [['AMB-001', 12]]));
    tracker.observe(frame(1000, [['AMB-001', 12]]));
    const state = frame(2000, [['AMB-001', 14]]);
    tracker.observe(state);
    expect(tracker.estimate(journey(state), 140)!).toBeLessThan(10);
  });
  it('rejects duplicate vehicle IDs in one snapshot', () => {
    const tracker = new AdaptiveEtaTracker();
    expect(() => tracker.observe(frame(0, [['AMB-001', 10], ['AMB-001', 11]]))).toThrow(/Duplicate/);
  });
  it('does not invent an ETA after a stopped vehicle', () => {
    const tracker = new AdaptiveEtaTracker();
    const stopped = frame(1000, [['AMB-001', 0]]);
    tracker.observe(stopped);
    expect(tracker.estimate(journey(stopped), 100)).toBeNull();
  });
});
