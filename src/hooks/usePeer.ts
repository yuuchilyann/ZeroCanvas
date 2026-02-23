import { useEffect, useRef, useCallback, useState } from 'react';
import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { ConnectionState, PeerRole } from '../types/peer';
import type { DrawMessage } from '../types/drawing';

const MAX_RETRIES = 5;
const RETRY_BASE_MS = 1000;

function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export interface UsePeerOptions {
  role: PeerRole;
  roomId?: string; // required when role === 'client'
  onMessage?: (msg: DrawMessage, fromPeerId: string) => void;
  onClientConnected?: (peerId: string) => void;
  onClientDisconnected?: (peerId: string) => void;
}

export interface UsePeerReturn {
  roomId: string;
  connectionState: ConnectionState;
  connectedClients: string[];
  sendMessage: (msg: DrawMessage, targetPeerId?: string) => void;
  broadcastMessage: (msg: DrawMessage) => void;
}

export function usePeer({
  role,
  roomId: providedRoomId,
  onMessage,
  onClientConnected,
  onClientDisconnected,
}: UsePeerOptions): UsePeerReturn {
  const [roomId] = useState<string>(
    () => providedRoomId ?? (role === 'host' ? generateRoomId() : '')
  );
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectedClients, setConnectedClients] = useState<string[]>([]);

  const peerRef = useRef<Peer | null>(null);
  // Map of peerId → DataConnection (host tracks all clients)
  const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
  // Single connection ref (client side)
  const hostConnRef = useRef<DataConnection | null>(null);
  const retryCountRef = useRef(0);
  const destroyedRef = useRef(false);

  const handleData = useCallback(
    (data: unknown, fromPeerId: string) => {
      if (onMessage) onMessage(data as DrawMessage, fromPeerId);
    },
    [onMessage]
  );

  const setupConnection = useCallback(
    (conn: DataConnection) => {
      conn.on('open', () => {
        if (role === 'host') {
          connectionsRef.current.set(conn.peer, conn);
          setConnectedClients((prev) => [...prev, conn.peer]);
          onClientConnected?.(conn.peer);
        } else {
          hostConnRef.current = conn;
          retryCountRef.current = 0;
          setConnectionState('connected');
        }
      });

      conn.on('data', (data) => handleData(data, conn.peer));

      conn.on('close', () => {
        if (role === 'host') {
          connectionsRef.current.delete(conn.peer);
          setConnectedClients((prev) => prev.filter((id) => id !== conn.peer));
          onClientDisconnected?.(conn.peer);
        } else {
          hostConnRef.current = null;
          if (!destroyedRef.current) {
            setConnectionState('disconnected');
            scheduleRetry();
          }
        }
      });

      conn.on('error', () => {
        if (role === 'client' && !destroyedRef.current) {
          setConnectionState('error');
          scheduleRetry();
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, handleData, onClientConnected, onClientDisconnected]
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  function scheduleRetry() {
    if (retryCountRef.current >= MAX_RETRIES) return;
    const delay = RETRY_BASE_MS * Math.pow(2, retryCountRef.current);
    retryCountRef.current += 1;
    setTimeout(() => {
      if (!destroyedRef.current && peerRef.current && roomId) {
        setConnectionState('connecting');
        const conn = peerRef.current.connect(roomId, { reliable: true });
        setupConnection(conn);
      }
    }, delay);
  }

  useEffect(() => {
    destroyedRef.current = false;
    const peerId = role === 'host' ? roomId : undefined;
    const peer = new Peer(peerId ?? '');
    peerRef.current = peer;
    setConnectionState('connecting');

    peer.on('open', () => {
      if (role === 'host') {
        setConnectionState('connected');
      } else {
        // Client: connect to host
        const conn = peer.connect(roomId, { reliable: true });
        setupConnection(conn);
      }
    });

    if (role === 'host') {
      peer.on('connection', (conn) => {
        setupConnection(conn);
      });
    }

    peer.on('error', (err) => {
      console.error('[PeerJS]', err);
      if (!destroyedRef.current) setConnectionState('error');
    });

    peer.on('disconnected', () => {
      if (!destroyedRef.current) {
        setConnectionState('disconnected');
        peer.reconnect();
      }
    });

    return () => {
      destroyedRef.current = true;
      peer.destroy();
      connectionsRef.current.clear();
      hostConnRef.current = null;
    };
  }, [roomId, role, setupConnection]);

  const sendMessage = useCallback(
    (msg: DrawMessage, targetPeerId?: string) => {
      if (role === 'host') {
        const conn = targetPeerId
          ? connectionsRef.current.get(targetPeerId)
          : undefined;
        conn?.send(msg);
      } else {
        hostConnRef.current?.send(msg);
      }
    },
    [role]
  );

  const broadcastMessage = useCallback(
    (msg: DrawMessage) => {
      if (role === 'host') {
        connectionsRef.current.forEach((conn) => conn.send(msg));
      } else {
        hostConnRef.current?.send(msg);
      }
    },
    [role]
  );

  return { roomId, connectionState, connectedClients, sendMessage, broadcastMessage };
}
