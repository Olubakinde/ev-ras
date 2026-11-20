import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Bounded simulated IDs, not real driver identity or public authentication. */
export const TRAFFIC_DRIVER_IDS: readonly string[] = Array.from(
  { length: 25 },
  (_, index) => `CAR-${String(index + 1).padStart(3, '0')}`,
);

@Injectable()
export class DemoAccessService {
  private readonly sessions = new Map<string, string>();

  /** Used by the Socket.IO gateway for targeted snapshots/reset events. */
  getDriverIds(): readonly string[] {
    return TRAFFIC_DRIVER_IDS;
  }

  assertOperatorAccess(key: unknown): void {
    const expected = process.env.EVRAS_DEMO_OPERATOR_KEY;
    if (!expected || expected.length < 16) {
      throw new UnauthorizedException(
        'Demo controls are disabled until a 16+ character operator key is configured',
      );
    }
    if (typeof key !== 'string') {
      throw new UnauthorizedException('Invalid demo operator key');
    }
    const actualBuffer = Buffer.from(key);
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid demo operator key');
    }
  }

  issueDriverToken(driverId: string): string {
    if (!TRAFFIC_DRIVER_IDS.includes(driverId)) {
      throw new BadRequestException('Unknown simulated driver');
    }
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, driverId);
    return token;
  }

  resolveDriver(token: unknown): string | null {
    if (typeof token !== 'string') return null;
    return this.sessions.get(token) ?? null;
  }
}
