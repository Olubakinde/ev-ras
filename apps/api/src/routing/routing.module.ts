
import { Module } from '@nestjs/common';

import { OsrmClient } from './osrm-client.js';
import { RoutingController } from './routing.controller.js';

@Module({
  controllers: [RoutingController],
  providers: [
    {
      provide: OsrmClient,
      useFactory: () => new OsrmClient(undefined, undefined, true),
    },
  ],
  exports: [OsrmClient],
})
export class RoutingModule {}
