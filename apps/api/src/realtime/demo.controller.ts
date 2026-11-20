
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

  function requireBody(
    value: unknown,
  ): Record<string, unknown> {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value)
    ) {
      throw new BadRequestException(
        'Request body must be an object',
      );
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
        throw new BadRequestException(
          'driverId must be a string',
        );
      }

      const token = this.access.issueDriverToken(
        driverId,
      );

      return {
        driverId,
        token,
        namespace: '/drivers',
      };
    }

    @Post('advance')
    advance(
      @Headers('x-demo-operator-key') operatorKey: string | undefined,
      @Body() body: unknown,
    ) {
      this.access.assertOperatorAccess(operatorKey);

      const data = requireBody(body);

      if (typeof data.deltaMs !== 'number') {
        throw new BadRequestException(
          'deltaMs must be a number',
        );
      }

      return this.simulation.advance(
        data.deltaMs,
      );
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
  }
