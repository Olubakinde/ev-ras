
import { Module } from '@nestjs/common';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RoutingModule } from './routing/routing.module.js';

@Module({
  imports: [
    RoutingModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
