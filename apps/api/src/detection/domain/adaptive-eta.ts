import type { SimulationState } from '../../simulation/domain/simulation.js';
import type { VehicleJourney } from './encounter-detector.js';

/** Experimental projection, not a road-safety ETA or a speed-limit model. */
export const ETA_TREND_SECONDS = 3;
const MAX_SAMPLE_GAP_MS = 5_000;
const MAX_ACCEL_MPS2 = 3;
const MAX_BRAKING_MPS2 = 5;
const EPSILON = 1e-9;

interface SpeedSample {
  readonly timeMs: number;
  readonly speedMps: number;
}

/**
 * Travel-time projection: maintain the observed acceleration for at most
 * three seconds, then hold the projected final speed constant. If a vehicle
 * reaches a complete stop before traversing the required distance, report
 * unknown/null rather than manufacturing an ETA.
 */
export function projectTravelSeconds(
  distanceM: number,
  speedMps: number,
  accelerationMps2 = 0,
): number | null {
  if (!Number.isFinite(distanceM) || distanceM < 0 ||
      !Number.isFinite(speedMps) || speedMps < 0 ||
      !Number.isFinite(accelerationMps2)) {
    throw new RangeError('Distance, speed and acceleration must be finite and valid');
  }
  if (distanceM === 0) return 0;
  if (speedMps === 0) return null;

  const acceleration = Math.max(-MAX_BRAKING_MPS2,
    Math.min(MAX_ACCEL_MPS2, accelerationMps2));
  if (Math.abs(acceleration) < EPSILON) return distanceM / speedMps;

  const stoppingTime = acceleration < 0 ? speedMps / -acceleration : Infinity;
  const phaseSeconds = Math.min(ETA_TREND_SECONDS, stoppingTime);
  const phaseDistance = speedMps * phaseSeconds +
    0.5 * acceleration * phaseSeconds * phaseSeconds;
  if (distanceM <= phaseDistance + EPSILON) {
    const discriminant = Math.max(0, speedMps * speedMps + 2 * acceleration * distanceM);
    const t = 2 * distanceM / (speedMps + Math.sqrt(discriminant));
    return Number.isFinite(t) ? t : null;
  }
  const finalSpeed = Math.max(0, speedMps + acceleration * phaseSeconds);
  if (finalSpeed <= EPSILON) return null;
  return phaseSeconds + (distanceM - phaseDistance) / finalSpeed;
}

function sustainedTrend(samples: readonly SpeedSample[]): number {
  if (samples.length < 3) return 0;
  const one = samples[samples.length - 3]!;
  const two = samples[samples.length - 2]!;
  const three = samples[samples.length - 1]!;
  const d1 = (two.timeMs - one.timeMs) / 1000;
  const d2 = (three.timeMs - two.timeMs) / 1000;
  if (d1 <= 0 || d2 <= 0 || d1 > 5 || d2 > 5) return 0;
  const a1 = (two.speedMps - one.speedMps) / d1;
  const a2 = (three.speedMps - two.speedMps) / d2;
  if (Math.abs(a1) < 0.05 || Math.abs(a2) < 0.05 || a1 * a2 <= 0) return 0;
  const max = a1 < 0 ? MAX_BRAKING_MPS2 : MAX_ACCEL_MPS2;
  // A sudden speed jump is a new setpoint, NOT evidence of sustained acceleration.
  if (Math.abs(a1) > max || Math.abs(a2) > max) return 0;
  if (Math.max(Math.abs(a1), Math.abs(a2)) /
      Math.min(Math.abs(a1), Math.abs(a2)) > 2) return 0;
  return (a1 + a2) / 2;
}

/** Per-scenario speed history. No global cross-request state or wall-clock reads. */
export class AdaptiveEtaTracker {
  private readonly samples = new Map<string, SpeedSample[]>();

  reset(state?: SimulationState): void {
    this.samples.clear();
    if (state) this.observe(state);
  }

  observe(state: SimulationState): void {
    if (!Number.isFinite(state.timeMs) || state.timeMs < 0) {
      throw new RangeError('Invalid speed observation time');
    }
    const current = new Set<string>();
    for (const entry of state.vehicles) {
      const { id, speedMps } = entry.vehicle;
      if (current.has(id)) throw new Error(`Duplicate speed observation: ${id}`);
      if (!Number.isFinite(speedMps) || speedMps < 0) {
        throw new RangeError('Invalid observed speed');
      }
      current.add(id);
      const previous = this.samples.get(id) ?? [];
      const last = previous.at(-1);
      if (last && last.timeMs === state.timeMs) {
        // A repeated snapshot must not count as evidence of acceleration.
        if (last.speedMps !== speedMps) {
          this.samples.set(id, [{ timeMs: state.timeMs, speedMps }]);
        }
        continue;
      }
      const keep = last && state.timeMs > last.timeMs &&
        state.timeMs - last.timeMs <= MAX_SAMPLE_GAP_MS ? previous : [];
      this.samples.set(id, [...keep, { timeMs: state.timeMs, speedMps }].slice(-3));
    }
    for (const id of this.samples.keys()) {
      if (!current.has(id)) this.samples.delete(id);
    }
  }

  estimate(journey: VehicleJourney, distanceM: number): number | null {
    const { id, speedMps, timestampMs } = journey.state.vehicle;
    const observations = this.samples.get(id) ?? [];
    const last = observations.at(-1);
    // Never extrapolate stale samples or a different physical state.
    const acceleration = last?.timeMs === timestampMs && last.speedMps === speedMps
      ? sustainedTrend(observations) : 0;
    return projectTravelSeconds(distanceM, speedMps, acceleration);
  }
}
