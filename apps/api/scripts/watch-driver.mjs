
import { io } from 'socket.io-client';

const token = process.env.DRIVER_TOKEN;

const url =
  process.env.EVRAS_SERVER_URL ??
  'http://localhost:3000/drivers';

if (!token) {
  console.error(
    'Missing DRIVER_TOKEN environment variable.',
  );

  process.exit(1);
}

const socket = io(url, {
  auth: { token },
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

socket.on('connect', () => {
  console.log('Connected to EV-RAS:', socket.id);
});

socket.on('connect_error', (error) => {
  console.error(
    'Connection error:',
    error.message,
  );

  // Invalid sessions won't become valid by
  // retrying the same token.
  if (
    error.message ===
    'Unauthorized driver session'
  ) {
    socket.disconnect();
    process.exitCode = 1;
  }
});

socket.on('session:ready', (payload) => {
  console.log('Driver session:', payload);
});

const events = [
  'simulation:snapshot',
  'simulation:tick',
  'simulation:reset',
  'simulation:unavailable',
  'alert:created',
  'alert:updated',
  'alert:cleared',
];

for (const eventName of events) {
  socket.on(eventName, (payload) => {
    console.log(
      `\n[${eventName}]`,
      JSON.stringify(payload, null, 2),
    );
  });
}

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});

process.on('SIGINT', () => {
  socket.disconnect();
  process.exit(0);
});
