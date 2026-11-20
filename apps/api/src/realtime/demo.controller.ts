import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
} from '@nestjs/common';

import { DemoAccessService } from './demo-access.service.js';
import { DemoSimulationService } from './demo-simulation.service.js';
import { DemoStateService } from './demo-state.service.js';
import { parseRoadScenarioRequest } from './road-scenario-request.js';

function requireBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('Request body must be an object');
  }
  return value as Record<string, unknown>;
}

@Controller('demo')
export class DemoController {
  constructor(
    private readonly access: DemoAccessService,
    private readonly simulation: DemoSimulationService,
    private readonly state: DemoStateService,
  ) {}

  @Post('sessions')
  createDriverSession(
    @Headers('x-demo-operator-key') operatorKey: string | undefined,
    @Body() body: unknown,
  ) {
    this.access.assertOperatorAccess(operatorKey);
    const data = requireBody(body);
    const driverId = data.driverId;
    if (typeof driverId !== 'string') {
      throw new BadRequestException('driverId must be a string');
    }
    const token = this.access.issueDriverToken(driverId);
    return { driverId, token, namespace: '/drivers' };
  }

  @Post('route-scenario')
  async loadRoadScenario(
    @Headers('x-demo-operator-key') operatorKey: string | undefined,
    @Body() body: unknown,
  ) {
    this.access.assertOperatorAccess(operatorKey);
    return this.simulation.loadRoadScenario(parseRoadScenarioRequest(body));
  }

  /** Additional, operator-only 25-car traffic preset. Existing APIs remain. */
  @Post('traffic')
  async loadTrafficScenario(
    @Headers('x-demo-operator-key') operatorKey: string | undefined,
    @Body() body: unknown,
  ) {
    this.access.assertOperatorAccess(operatorKey);
    const data = requireBody(body);
    const seed = data.seed === undefined ? 2026 : data.seed;
    if (
      typeof seed !== 'number' ||
      !Number.isSafeInteger(seed) ||
      seed < 0 ||
      seed > 4_294_967_295
    ) {
      throw new BadRequestException('seed must be a 32-bit unsigned integer');
    }
    return this.simulation.loadMixedTrafficScenario(seed);
  }

  @Get('traffic')
  getTrafficScenario(
    @Headers('x-demo-operator-key') operatorKey: string | undefined,
  ) {
    this.access.assertOperatorAccess(operatorKey);
    return this.simulation.getTrafficMetadata();
  }

  @Post('advance')
  advance(
    @Headers('x-demo-operator-key') operatorKey: string | undefined,
    @Body() body: unknown,
  ) {
    this.access.assertOperatorAccess(operatorKey);
    const data = requireBody(body);
    if (typeof data.deltaMs !== 'number') {
      throw new BadRequestException('deltaMs must be a number');
    }
    return this.simulation.advance(data.deltaMs);
  }

  @Post('reset')
  reset(
    @Headers('x-demo-operator-key') operatorKey: string | undefined,
  ) {
    this.access.assertOperatorAccess(operatorKey);
    return this.simulation.reset();
  }

  @Get('state')
  getState(
    @Headers('x-demo-operator-key') operatorKey: string | undefined,
  ) {
    this.access.assertOperatorAccess(operatorKey);
    return this.state.getOperatorSnapshot();
  }

  @Get('routes')
  getRoutes(
    @Headers('x-demo-operator-key') operatorKey: string | undefined,
  ) {
    this.access.assertOperatorAccess(operatorKey);
    return this.simulation.getRouteMetadata();
  }
}
