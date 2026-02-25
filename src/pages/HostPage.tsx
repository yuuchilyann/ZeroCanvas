import React, { useCallback, useRef, useState } from 'react';
import { Box, Drawer, Fab, IconButton, Tooltip, Typography } from '@mui/material';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import EditIcon from '@mui/icons-material/Edit';
import EditOffIcon from '@mui/icons-material/EditOff';
import { PeerProvider, usePeerContext } from '../contexts/PeerContext';
import { SyncService } from '../services/syncService';
import DrawingCanvas from '../components/DrawingCanvas';
import ConnectionStatus from '../components/ConnectionStatus';
import QRCodeDisplay from '../components/QRCodeDisplay';
import Toolbar from '../components/Toolbar';
import type { DrawMessage, DrawStyle, Tool } from '../types/drawing';
import type { useDrawing } from '../hooks/useDrawing';

function buildClientUrl(roomId: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?role=client&room=${roomId}`;
}

/* ── Inner component (has access to PeerContext) ─────────────── */
function HostBoard() {
  const { roomId, connectionState, connectedClients, sendMessage, broadcastMessage } =
    usePeerContext();

  // Stable ref so handleMessage closure never goes stale
  const connectedClientsRef = useRef(connectedClients);
  connectedClientsRef.current = connectedClients;

  const syncRef = useRef<SyncService>(new SyncService(sendMessage, broadcastMessage));
  const applyRef = useRef<((msg: DrawMessage) => void) | null>(null);
  const getDataUrlRef = useRef<(() => string) | null>(null);
  const clearFnRef = useRef<(() => void) | null>(null);
  const internalHookRef = useRef<ReturnType<typeof useDrawing> | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [drawStyle, setDrawStyle] = useState<DrawStyle>({ tool: 'pen', color: '#000000', width: 4 });
  const boardRef = useRef<HTMLDivElement>(null);

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
        const strokes = internalHookRef.current?.getStrokes() ?? [];
        sendMessage({ type: 'sync_strokes', strokes }, fromPeerId);
        return;
      }
      // Apply to Host canvas
      applyRef.current?.(parsed);
      // Relay to all other connected clients (excluding the sender)
      syncRef.current.relayToOthers(parsed, fromPeerId, connectedClientsRef.current);
    },
    []
  );

  // Register message handler via context (deferred to avoid stale closure)
  const { setOnMessage } = usePeerContext();
  React.useEffect(() => {
    setOnMessage(handleMessage);
  }, [setOnMessage, handleMessage]);

  // Host local drawing: broadcast strokes to all clients
  const handleLocalMessage = useCallback((msg: DrawMessage) => {
    syncRef.current.sendDraw(msg);
  }, []);

  const handleSave = useCallback(() => {
    const dataUrl = getDataUrlRef.current?.();
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `zerocanvas-${Date.now()}.png`;
    a.click();
  }, []);

  const handleClear = useCallback(() => {
    clearFnRef.current?.();
    syncRef.current.sendDraw({ type: 'clear' });
  }, []);

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
      {/* Canvas — readOnly toggled by drawMode */}
      <DrawingCanvas
        readOnly={!drawMode}
        onMessage={drawMode ? handleLocalMessage : undefined}
        onApplyMessage={(fn) => { applyRef.current = fn; }}
        onSnapshot={(fn) => { getDataUrlRef.current = fn; }}
        onClear={(fn) => { clearFnRef.current = fn; }}
        onDrawingHook={(hook) => { internalHookRef.current = hook; }}
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

      {/* QR Code side tab (collapsed state) */}
      {!qrOpen && (
        <Tooltip title="顯示 QR Code" placement="left">
          <IconButton
            onClick={() => setQrOpen(true)}
            sx={{
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 10,
              bgcolor: 'primary.main',
              color: '#fff',
              borderRadius: '8px 0 0 8px',
              px: 0.5,
              py: 2,
              '&:hover': { bgcolor: 'primary.dark' },
            }}
          >
            <QrCode2Icon />
          </IconButton>
        </Tooltip>
      )}

      {/* QR Code drawer */}
      <Drawer
        anchor="right"
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        variant="persistent"
        sx={{
          '& .MuiDrawer-paper': {
            width: 232,
            boxSizing: 'border-box',
            bgcolor: 'background.paper',
          },
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'flex-start', p: 0.5 }}>
          <IconButton onClick={() => setQrOpen(false)} size="small">
            <ChevronRightIcon />
          </IconButton>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'center', px: 1, pb: 2 }}>
          <QRCodeDisplay url={clientUrl} roomId={roomId} />
        </Box>
      </Drawer>

      {/* Drawing mode toggle (bottom-left FAB) */}
      <Tooltip title={drawMode ? '關閉繪圖模式' : '開啟繪圖模式'} placement="right">
        <Fab
          size="medium"
          color={drawMode ? 'primary' : 'default'}
          onClick={() => setDrawMode((v) => !v)}
          sx={{ position: 'absolute', bottom: 16, left: 16, zIndex: 10 }}
        >
          {drawMode ? <EditOffIcon /> : <EditIcon />}
        </Fab>
      </Tooltip>

      {/* Floating toolbar (only visible in draw mode) */}
      {drawMode && (
        <Box
          sx={{
            position: 'absolute', left: 16, top: '50%',
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
            onSave={handleSave}
            orientation="vertical"
          />
        </Box>
      )}
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
