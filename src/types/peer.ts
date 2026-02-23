export type PeerRole = 'host' | 'client';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface RoomInfo {
  roomId: string;
  role: PeerRole;
}
