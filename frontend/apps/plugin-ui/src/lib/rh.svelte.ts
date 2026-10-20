/**
 * The socket.io connection to RotorHazard, as Svelte 5 runes state.
 *
 * The SPA is served from inside RotorHazard, so the socket goes to the same origin (in
 * `make dev`, Vite proxies `/socket.io` to the rig). Everything the UI learns about the
 * timer arrives on this socket: RotorHazard's own events (`heartbeat`, `pilot_data`, …)
 * and the plugin's `gridfpv_*` channel.
 */
import { io, type Socket } from 'socket.io-client';

export type HelloAck = {
  plugin_version: string;
  rhapi_version: string;
  rh_version: string | null;
  seat_count: number;
  redirect_home: boolean;
};

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

let socket: Socket | null = null;

const state = $state({
  connection: 'connecting' as ConnectionState,
  hello: null as HelloAck | null
});

/** Read-only view of the connection for screens. */
export function rh() {
  return state;
}

/** Open the socket once; safe to call again (returns the existing one). */
export function connect(): Socket {
  if (socket) return socket;
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    state.connection = 'connected';
    socket?.emit('gridfpv_hello', { client: 'plugin-ui' });
  });
  socket.on('disconnect', () => {
    state.connection = 'disconnected';
    state.hello = null;
  });
  socket.on('gridfpv_hello_ack', (ack: HelloAck) => {
    state.hello = ack;
  });
  return socket;
}
