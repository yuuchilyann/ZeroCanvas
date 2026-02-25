import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Alert, Button, Collapse } from '@mui/material';
import { PeerProvider, usePeerContext } from '../contexts/PeerContext';
import { SyncService } from '../services/syncService';
import DrawingCanvas from '../components/DrawingCanvas';
import ConnectionStatus from '../components/ConnectionStatus';
import Toolbar from '../components/Toolbar';
import type { useDrawing } from '../hooks/useDrawing';
import type { DrawMessage, DrawStyle, Tool } from '../types/drawing';

/* ── Inner component ─────────────────────────────────────────── */
function ClientBoard({ roomId }: { roomId: string }) {
  const { connectionState, sendMessage, broadcastMessage } = usePeerContext();

  const syncRef = useRef<SyncService>(new SyncService(sendMessage, broadcastMessage));
  const clearFnRef = useRef<(() => void) | null>(null);
  const applyRef = useRef<((msg: DrawMessage) => void) | null>(null);

  // Ref to the canvas's internal drawing hook — updated every render via onDrawingHook
  const internalHookRef = useRef<ReturnType<typeof useDrawing> | null>(null);
  // Mirror style in local state so Toolbar re-renders on change
  const [drawStyle, setDrawStyle] = useState<DrawStyle>({ tool: 'pen', color: '#000000', width: 4 });

  useEffect(() => {
    syncRef.current = new SyncService(sendMessage, broadcastMessage);
  }, [sendMessage, broadcastMessage]);

  useEffect(() => {
    syncRef.current.setConnected(connectionState === 'connected');
  }, [connectionState]);

  // Request snapshot on first connect
  const { setOnMessage } = usePeerContext();
  const prevStateRef = useRef(connectionState);
  useEffect(() => {
    if (prevStateRef.current !== 'connected' && connectionState === 'connected') {
      broadcastMessage({ type: 'snapshot_request' });
    }
    prevStateRef.current = connectionState;
  }, [connectionState, broadcastMessage]);

  // Apply all incoming messages relayed from Host (other clients' strokes + snapshot)
  useEffect(() => {
    setOnMessage((msg) => {
      applyRef.current?.(msg);
    });
  }, [setOnMessage]);

  const handleClear = useCallback(() => {
    clearFnRef.current?.();
    syncRef.current.sendDraw({ type: 'clear' });
  }, []);

  // Toolbar handlers: update local state AND call into canvas's internal hook
  const handleToolChange = useCallback((tool: Tool) => {
    internalHookRef.current?.setTool(tool);
    setDrawStyle((s) => ({ ...s, tool }));
  }, []);
  const handleColorChange = useCallback((color: string) => {
    internalHookRef.current?.setColor(color);
    setDrawStyle((s) => ({ ...s, color }));
  }, []);
  const handleWidthChange = useCallback((width: number) => {
    internalHookRef.current?.setWidth(width);
    setDrawStyle((s) => ({ ...s, width }));
  }, []);

  const isDisconnected = connectionState === 'disconnected' || connectionState === 'error';

  return (
    <Box sx={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Connection banner */}
      <Collapse in={isDisconnected}>
        <Alert
          severity="warning"
          sx={{ borderRadius: 0, py: 0.5 }}
          action={
            <Button color="inherit" size="small" onClick={() => window.location.reload()}>
              重新連線
            </Button>
          }
        >
          {connectionState === 'error'
            ? `連線錯誤，正在重試...`
            : `與 ${roomId} 的連線中斷，正在重連...`}
        </Alert>
      </Collapse>

      {/* Main drawing area */}
      <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <DrawingCanvas
          onMessage={(msg) => syncRef.current.sendDraw(msg)}
          onApplyMessage={(fn) => { applyRef.current = fn; }}
          onClear={(fn) => { clearFnRef.current = fn; }}
          // Store canvas's internal hook in ref; no state update so no extra re-render
          onDrawingHook={(hook) => { internalHookRef.current = hook; }}
        />

        {/* Floating toolbar (left side) */}
        <Box
          sx={{
            position: 'absolute', left: 12, top: '50%',
            transform: 'translateY(-50%)', zIndex: 10,
          }}
        >
          <Toolbar
            tool={drawStyle.tool}
            color={drawStyle.color}
            width={drawStyle.width}
            onToolChange={handleToolChange}
            onColorChange={handleColorChange}
            onWidthChange={handleWidthChange}
            onClear={handleClear}
            orientation="vertical"
          />
        </Box>

        {/* Connection status (top right) */}
        <Box
          sx={{
            position: 'absolute', top: 12, right: 12,
            bgcolor: 'background.paper', borderRadius: 2,
            px: 1, py: 0.5, boxShadow: 2, zIndex: 10,
          }}
        >
          <ConnectionStatus state={connectionState} />
        </Box>

        {/* Room ID indicator (top center) */}
        <Box
          sx={{
            position: 'absolute', top: 12, left: '50%',
            transform: 'translateX(-50%)',
            bgcolor: 'background.paper', borderRadius: 2,
            px: 1.5, py: 0.5, boxShadow: 2, zIndex: 10,
            fontSize: 13, fontWeight: 700, letterSpacing: 2, color: 'primary.main',
          }}
        >
          {roomId}
        </Box>
      </Box>
    </Box>
  );
}

/* ── Page wrapper ────────────────────────────────────────────── */
interface ClientPageProps {
  roomId: string;
}

const ClientPage: React.FC<ClientPageProps> = ({ roomId }) => (
  <PeerProvider role="client" roomId={roomId}>
    <ClientBoard roomId={roomId} />
  </PeerProvider>
);

export default ClientPage;

