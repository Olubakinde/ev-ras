
import { describe, expect, it } from 'vitest';
import { createVehicle, type VehicleState } from './vehicle';

const validVehicle: VehicleState = {
  id: 'AMB-001',
  kind: 'EMERGENCY',
  position: {
    latitude: 39.6837,
    longitude: -75.7497,
  },
  speedMps: 15,
  headingDeg: 90,
  timestampMs: 1795176000000,
};

describe('createVehicle', () => {
  describe('valid vehicle states', () => {
    it('accepts a valid emergency vehicle', () => {
      expect(createVehicle(validVehicle)).toEqual(validVehicle);
    });

    it('accepts a valid civilian vehicle', () => {
      const civilian: VehicleState = {
        ...validVehicle,
        id: 'CAR-001',
        kind: 'CIVILIAN',
      };

      expect(createVehicle(civilian)).toEqual(civilian);
    });

    it('accepts zero speed', () => {
      const vehicle = {
        ...validVehicle,
        speedMps: 0,
      };

      expect(createVehicle(vehicle).speedMps).toBe(0);
    });

    it('accepts valid coordinate boundaries', () => {
      const vehicle = {
        ...validVehicle,
        position: {
          latitude: 90,
          longitude: -180,
        },
      };

      expect(createVehicle(vehicle)).toEqual(vehicle);
    });

    it('accepts a heading of zero degrees', () => {
      const vehicle = {
        ...validVehicle,
        headingDeg: 0,
      };

      expect(createVehicle(vehicle).headingDeg).toBe(0);
    });

    it('accepts a heading below 360 degrees', () => {
      const vehicle = {
        ...validVehicle,
        headingDeg: 359.99,
      };

      expect(createVehicle(vehicle)).toEqual(vehicle);
    });

    it('accepts a timestamp of zero', () => {
      const vehicle = {
        ...validVehicle,
        timestampMs: 0,
      };

      expect(createVehicle(vehicle)).toEqual(vehicle);
    });
  });

  describe('vehicle identity', () => {
    it('rejects an empty vehicle ID', () => {
      expect(() =>
        createVehicle({ ...validVehicle, id: '' }),
      ).toThrow('Vehicle ID cannot be empty');
    });

    it('rejects a whitespace-only ID', () => {
      expect(() =>
        createVehicle({ ...validVehicle, id: '   ' }),
      ).toThrow('Vehicle ID cannot be empty');
    });

    it('rejects an invalid vehicle kind', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          kind: 'UNKNOWN' as VehicleState['kind'],
        }),
      ).toThrow('Invalid vehicle kind');
    });
  });

  describe('geographic coordinates', () => {
    it('rejects latitude above 90', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          position: { latitude: 91, longitude: 0 },
        }),
      ).toThrow(RangeError);
    });

    it('rejects latitude below -90', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          position: { latitude: -91, longitude: 0 },
        }),
      ).toThrow(RangeError);
    });

    it('rejects longitude above 180', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          position: { latitude: 0, longitude: 181 },
        }),
      ).toThrow(RangeError);
    });

    it('rejects longitude below -180', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          position: { latitude: 0, longitude: -181 },
        }),
      ).toThrow(RangeError);
    });

    it('rejects NaN latitude', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          position: { latitude: NaN, longitude: 0 },
        }),
      ).toThrow(RangeError);
    });

    it('rejects infinite longitude', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          position: {
            latitude: 0,
            longitude: Infinity,
          },
        }),
      ).toThrow(RangeError);
    });

    it('rejects a missing position', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          position: undefined as unknown as VehicleState['position'],
        }),
      ).toThrow('Vehicle position is required');
    });
  });

  describe('vehicle motion', () => {
    it('rejects negative speed', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          speedMps: -5,
        }),
      ).toThrow(RangeError);
    });

    it('rejects infinite speed', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          speedMps: Infinity,
        }),
      ).toThrow(RangeError);
    });

    it('rejects NaN speed', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          speedMps: NaN,
        }),
      ).toThrow(RangeError);
    });

    it('rejects negative heading', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          headingDeg: -1,
        }),
      ).toThrow(RangeError);
    });

    it('rejects heading of 360 degrees', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          headingDeg: 360,
        }),
      ).toThrow(RangeError);
    });
  });

  describe('timestamps', () => {
    it('rejects negative timestamps', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          timestampMs: -100,
        }),
      ).toThrow(RangeError);
    });

    it('rejects NaN timestamps', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          timestampMs: NaN,
        }),
      ).toThrow(RangeError);
    });

    it('rejects infinite timestamps', () => {
      expect(() =>
        createVehicle({
          ...validVehicle,
          timestampMs: Infinity,
        }),
      ).toThrow(RangeError);
    });
  });
});
