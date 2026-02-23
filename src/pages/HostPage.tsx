import React, { useCallback, useRef } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import { PeerProvider, usePeerContext } from '../contexts/PeerContext';
import { SyncService } from '../services/syncService';
import DrawingCanvas from '../components/DrawingCanvas';
import ConnectionStatus from '../components/ConnectionStatus';
import QRCodeDisplay from '../components/QRCodeDisplay';
import type { DrawMessage } from '../types/drawing';

function buildClientUrl(roomId: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?role=client&room=${roomId}`;
}

/* ── Inner component (has access to PeerContext) ─────────────── */
function HostBoard() {
  const { roomId, connectionState, connectedClients, sendMessage, broadcastMessage } =
    usePeerContext();

  const syncRef = useRef<SyncService>(new SyncService(sendMessage, broadcastMessage));
  const applyRef = useRef<((msg: DrawMessage) => void) | null>(null);
  const getDataUrlRef = useRef<(() => string) | null>(null);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const boardRef = React.useRef<HTMLDivElement>(null);

  // Keep sync service connected state in sync
  React.useEffect(() => {
    syncRef.current = new SyncService(sendMessage, broadcastMessage);
  }, [sendMessage, broadcastMessage]);

  React.useEffect(() => {
    syncRef.current.setConnected(connectionState === 'connected');
  }, [connectionState]);

  const handleMessage = useCallback(
    (msg: DrawMessage, fromPeerId: string) => {
      const parsed = SyncService.parse(msg);
      if (!parsed) return;
      if (parsed.type === 'snapshot_request') {
        syncRef.current.handleSnapshotRequest(
          () => getDataUrlRef.current?.() ?? '',
          fromPeerId
        );
        return;
      }
      applyRef.current?.(parsed);
    },
    []
  );

  // Register message handler via context (deferred to avoid stale closure)
  const { setOnMessage } = usePeerContext();
  React.useEffect(() => {
    setOnMessage(handleMessage);
  }, [setOnMessage, handleMessage]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      boardRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const clientUrl = buildClientUrl(roomId);

  return (
    <Box ref={boardRef} sx={{ width: '100vw', height: '100vh', position: 'relative', bgcolor: '#fff' }}>
      {/* Canvas (read-only display) */}
      <DrawingCanvas
        readOnly
        onApplyMessage={(fn) => { applyRef.current = fn; }}
        onSnapshot={(fn) => { getDataUrlRef.current = fn; }}
      />

      {/* Top-left status bar */}
      <Box
        sx={{
          position: 'absolute', top: 12, left: 12,
          display: 'flex', alignItems: 'center', gap: 1,
          bgcolor: 'background.paper', borderRadius: 2, px: 1.5, py: 0.75,
          boxShadow: 3, zIndex: 10,
        }}
      >
        <Typography variant="subtitle2" fontWeight={700} color="primary">
          ZeroCanvas
        </Typography>
        <ConnectionStatus state={connectionState} clientCount={connectedClients.length} />
      </Box>

      {/* Fullscreen button */}
      <Tooltip title={isFullscreen ? '退出全螢幕' : '全螢幕'}>
        <IconButton
          onClick={toggleFullscreen}
          sx={{ position: 'absolute', top: 12, right: 12, bgcolor: 'background.paper', zIndex: 10 }}
        >
          {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
        </IconButton>
      </Tooltip>

      {/* Bottom-right QR panel */}
      <Box sx={{ position: 'absolute', bottom: 16, right: 16, zIndex: 10 }}>
        <QRCodeDisplay url={clientUrl} roomId={roomId} />
      </Box>
    </Box>
  );
}

/* ── Page wrapper (provides PeerContext as host) ─────────────── */
const HostPage: React.FC = () => (
  <PeerProvider role="host">
    <HostBoard />
  </PeerProvider>
);

export default HostPage;
