import { describe, expect, it } from 'vitest';
import {
  alertTitle,
  DEMO_ROUTES,
  displayRoutes,
  formatDistance,
  formatSimTime,
  getPrimaryDriverAlert,
  vehicleLabel,
  type OperatorSnapshot,
} from './scene';

describe('scene presentation', () => {
  it('formats simulated clock time', () => {
    expect(formatSimTime(0)).toBe('00:00');
    expect(formatSimTime(7000)).toBe('00:07');
    expect(formatSimTime(65_900)).toBe('01:05');
  });

  it('formats route distance', () => {
    expect(formatDistance(0)).toBe('—');
    expect(formatDistance(255)).toBe('255 m');
    expect(formatDistance(1450.8)).toBe('1.45 km');
  });

  it('uses illustrative geometry in the initial demo', () => {
    expect(displayRoutes({ source: 'DEMO', routes: [] })).toEqual(DEMO_ROUTES);
  });

  it('prefers routed OSRM geometry when available', () => {
    const custom = [{ ...DEMO_ROUTES[0], distanceMeters: 1200 }];
    expect(displayRoutes({ source: 'OSRM', routes: custom })).toEqual(custom);
  });

  it('labels emergency vehicles and drivers', () => {
    expect(vehicleLabel('AMB-001')).toBe('Emergency vehicle');
    expect(vehicleLabel('CAR-001')).toBe('Driver 01');
  });

  it('does not claim a predicted collision as confirmed', () => {
    expect(alertTitle('CROSSING')).toBe('Potential crossing ahead');
  });

  it('selects only the monitored driver alert', () => {
    const snapshot: OperatorSnapshot = {
      timeMs: 1000,
      vehicles: [],
      alerts: [
        { id:'other', civilianVehicleId:'CAR-002', emergencyVehicleId:'AMB-001', location:{latitude:0,longitude:0}, reason:'CROSSING', classification:'UNVERIFIED_ROUTE_ENCOUNTER', emergencyEtaSeconds:5, civilianEtaSeconds:5, etaDifferenceSeconds:0, firstDetectedAtMs:1000, lastUpdatedAtMs:1000 },
        { id:'primary', civilianVehicleId:'CAR-001', emergencyVehicleId:'AMB-001', location:{latitude:0,longitude:0}, reason:'CROSSING', classification:'UNVERIFIED_ROUTE_ENCOUNTER', emergencyEtaSeconds:5, civilianEtaSeconds:5, etaDifferenceSeconds:0, firstDetectedAtMs:1000, lastUpdatedAtMs:1000 },
      ],
    };
    expect(getPrimaryDriverAlert(snapshot)?.id).toBe('primary');
  });
});
