
import {
    WebSocketGateway,
    WebSocketServer,
    type OnGatewayConnection,
    type OnGatewayInit,
  } from '@nestjs/websockets';

  import type {
    Namespace,
    Socket,
  } from 'socket.io';

  import type {
    AlertEvent,
  } from '../alerts/domain/alert-manager.js';

  import { DemoAccessService } from './demo-access.service.js';
  import { DemoStateService } from './demo-state.service.js';

  function driverRoom(driverId: string): string {
    return `driver:${driverId}`;
  }

  @WebSocketGateway({
    namespace: '/drivers',
    cors: {
      origin: [
        'http://localhost:5173',
        'http://localhost:3000',
      ],
    },
  })
  export class DriversGateway
    implements OnGatewayInit, OnGatewayConnection
  {
    @WebSocketServer()
    server!: Namespace;

    constructor(
      private readonly access: DemoAccessService,
      private readonly state: DemoStateService,
    ) {}

    afterInit(server: Namespace): void {
      server.use((socket, next) => {
        const token: unknown =
          socket.handshake.auth?.token;

        const driverId =
          this.access.resolveDriver(token);

        if (!driverId) {
          next(
            new Error('Unauthorized driver session'),
          );
          return;
        }

        socket.data.driverId = driverId;
        next();
      });
    }

    handleConnection(client: Socket): void {
      const driverId: unknown =
        client.data.driverId;

      if (typeof driverId !== 'string') {
        client.disconnect(true);
        return;
      }

      void client.join(driverRoom(driverId));

      client.emit('session:ready', {
        driverId,
      });

      const snapshot =
        this.state.snapshotForDriver(driverId);

      if (snapshot) {
        client.emit(
          'simulation:snapshot',
          snapshot,
        );
      } else {
        client.emit(
          'simulation:unavailable',
          { driverId },
        );
      }
    }

    publishAlertEvents(
      events: readonly AlertEvent[],
    ): void {
      for (const event of events) {
        const room = driverRoom(
          event.alert.civilianVehicleId,
        );

        switch (event.type) {
          case 'CREATED':
            this.server.to(room).emit(
              'alert:created',
              event.alert,
            );
            break;

          case 'UPDATED':
            this.server.to(room).emit(
              'alert:updated',
              event.alert,
            );
            break;

          case 'CLEARED':
            this.server.to(room).emit(
              'alert:cleared',
              event.alert,
            );
            break;
        }
      }
    }

    publishTick(): void {
      for (
        const driverId of this.access.getDriverIds()
      ) {
        const snapshot =
          this.state.snapshotForDriver(driverId);

        if (snapshot) {
          this.server
            .to(driverRoom(driverId))
            .emit('simulation:tick', snapshot);
        }
      }
    }

    publishReset(): void {
      for (
        const driverId of this.access.getDriverIds()
      ) {
        const room = driverRoom(driverId);

        const snapshot =
          this.state.snapshotForDriver(driverId);

        if (snapshot) {
          this.server
            .to(room)
            .emit('simulation:reset', snapshot);
        } else {
          this.server
            .to(room)
            .emit('simulation:unavailable', {
              driverId,
            });
        }
      }
    }
  }
