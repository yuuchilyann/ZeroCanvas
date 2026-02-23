import React, { createContext, useContext, useRef, useCallback, useState } from 'react';
import { usePeer, type UsePeerOptions } from '../hooks/usePeer';
import type { ConnectionState, PeerRole } from '../types/peer';
import type { DrawMessage } from '../types/drawing';

interface PeerContextValue {
  roomId: string;
  role: PeerRole;
  connectionState: ConnectionState;
  connectedClients: string[];
  sendMessage: (msg: DrawMessage, targetPeerId?: string) => void;
  broadcastMessage: (msg: DrawMessage) => void;
  setOnMessage: (fn: (msg: DrawMessage, fromPeerId: string) => void) => void;
}

const PeerContext = createContext<PeerContextValue | null>(null);

interface PeerProviderProps {
  role: PeerRole;
  roomId?: string;
  children: React.ReactNode;
  onClientConnected?: (peerId: string) => void;
  onClientDisconnected?: (peerId: string) => void;
}

export function PeerProvider({
  role,
  roomId: providedRoomId,
  children,
  onClientConnected,
  onClientDisconnected,
}: PeerProviderProps) {
  const onMessageRef = useRef<((msg: DrawMessage, fromPeerId: string) => void) | null>(null);
  const [, forceUpdate] = useState(0);

  const handleMessage = useCallback((msg: DrawMessage, fromPeerId: string) => {
    onMessageRef.current?.(msg, fromPeerId);
  }, []);

  const options: UsePeerOptions = {
    role,
    roomId: providedRoomId,
    onMessage: handleMessage,
    onClientConnected,
    onClientDisconnected,
  };

  const { roomId, connectionState, connectedClients, sendMessage, broadcastMessage } =
    usePeer(options);

  const setOnMessage = useCallback(
    (fn: (msg: DrawMessage, fromPeerId: string) => void) => {
      onMessageRef.current = fn;
      forceUpdate((n) => n + 1);
    },
    []
  );

  return (
    <PeerContext.Provider
      value={{ roomId, role, connectionState, connectedClients, sendMessage, broadcastMessage, setOnMessage }}
    >
      {children}
    </PeerContext.Provider>
  );
}

export function usePeerContext(): PeerContextValue {
  const ctx = useContext(PeerContext);
  if (!ctx) throw new Error('usePeerContext must be used within PeerProvider');
  return ctx;
}
