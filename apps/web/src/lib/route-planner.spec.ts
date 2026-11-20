import { describe, expect, it } from 'vitest';
import {
  chooseRoutePoint,
  draftValidationMessage,
  EMPTY_ROUTE_DRAFT,
  formatPoint,
  nextUnselectedPoint,
  selectedPointCount,
  toRouteScenarioRequest,
} from './route-planner';

const A = { latitude: 39.6838, longitude: -75.7542 };
const B = { latitude: 39.6841, longitude: -75.7487 };
const C = { latitude: 39.6818, longitude: -75.7525 };
const D = { latitude: 39.6854, longitude: -75.7525 };

const complete = {
  ambulanceOrigin: A,
  ambulanceDestination: B,
  driverOrigin: C,
  driverDestination: D,
};

describe('map route planner', () => {
  it('begins with four empty route points', () => {
    expect(selectedPointCount(EMPTY_ROUTE_DRAFT)).toBe(0);
    expect(nextUnselectedPoint(EMPTY_ROUTE_DRAFT)).toBe('ambulanceOrigin');
  });

  it('records selected points without mutating the draft', () => {
    const result = chooseRoutePoint(EMPTY_ROUTE_DRAFT, 'ambulanceOrigin', A);
    expect(result.ambulanceOrigin).toEqual(A);
    expect(EMPTY_ROUTE_DRAFT.ambulanceOrigin).toBeNull();
    expect(result.ambulanceOrigin).not.toBe(A);
  });

  it('advances to the next unselected point', () => {
    expect(nextUnselectedPoint({ ...complete, driverDestination: null })).toBe('driverDestination');
    expect(nextUnselectedPoint(complete)).toBeNull();
  });

  it('supports replacing a previously selected location', () => {
    const changed = chooseRoutePoint(complete, 'ambulanceOrigin', C);
    expect(changed.ambulanceOrigin).toEqual(C);
    expect(changed.ambulanceDestination).toEqual(B);
  });

  it('rejects invalid coordinates', () => {
    expect(() => chooseRoutePoint(EMPTY_ROUTE_DRAFT, 'driverOrigin', { latitude: 91, longitude: -75 })).toThrow(RangeError);
    expect(() => chooseRoutePoint(EMPTY_ROUTE_DRAFT, 'driverOrigin', { latitude: NaN, longitude: -75 })).toThrow(RangeError);
  });

  it('requires all four locations', () => {
    expect(draftValidationMessage(EMPTY_ROUTE_DRAFT)).toContain('four');
    expect(() => toRouteScenarioRequest(EMPTY_ROUTE_DRAFT)).toThrow();
  });

  it('requires a meaningful ambulance route', () => {
    const invalid = { ...complete, ambulanceDestination: { ...A } };
    expect(draftValidationMessage(invalid)).toContain('Ambulance');
  });

  it('requires a meaningful civilian route', () => {
    const invalid = { ...complete, driverDestination: { ...C } };
    expect(draftValidationMessage(invalid)).toContain('Driver');
  });

  it('builds an API-compatible two-vehicle scenario', () => {
    expect(toRouteScenarioRequest(complete)).toEqual({
      vehicles: [
        { id: 'AMB-001', origin: A, destination: B, speedMps: 15 },
        { id: 'CAR-001', origin: C, destination: D, speedMps: 12 },
      ],
    });
  });

  it('does not hand out mutable references to selected coordinates', () => {
    const request = toRouteScenarioRequest(complete);
    expect(request.vehicles[0].origin).not.toBe(A);
  });

  it('formats decimal-degree positions for operator confirmation', () => {
    expect(formatPoint(A)).toBe('39.68380, -75.75420');
    expect(formatPoint(null)).toBe('Choose on map');
  });
});
