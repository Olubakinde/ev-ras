
import { Module } from '@nestjs/common';

import { RoutingModule } from '../routing/routing.module.js';

import { DemoAccessService } from './demo-access.service.js';
import { DemoController } from './demo.controller.js';
import { DemoSimulationService } from './demo-simulation.service.js';
import { DemoStateService } from './demo-state.service.js';
import { DriversGateway } from './drivers.gateway.js';

@Module({
  imports: [RoutingModule],
  controllers: [DemoController],
  providers: [
    DemoAccessService,
    DemoStateService,
    DriversGateway,
    DemoSimulationService,
  ],
})
export class RealtimeModule {}
