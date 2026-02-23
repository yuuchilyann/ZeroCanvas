import React, { useEffect, useRef, useCallback } from 'react';
import { Box } from '@mui/material';
import type { DrawMessage } from '../types/drawing';
import { useDrawing, type UseDrawingOptions } from '../hooks/useDrawing';

interface DrawingCanvasProps {
  readOnly?: boolean;
  onMessage?: (msg: DrawMessage) => void;
  onApplyMessage?: (apply: (msg: DrawMessage) => void) => void;
  onSnapshot?: (getDataUrl: () => string) => void;
  onClear?: (clear: () => void) => void;
  onDrawingHook?: (hook: ReturnType<typeof useDrawing>) => void;
}

function resizeCanvas(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
}

const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  readOnly = false,
  onMessage,
  onApplyMessage,
  onSnapshot,
  onClear,
  onDrawingHook,
}) => {
  const staticRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  const drawingHookOptions: UseDrawingOptions = {
    onStrokeMessage: readOnly ? undefined : onMessage,
    // Pass staticRef so onPointerUp can commit strokes locally
    staticCanvasRef: readOnly ? undefined : staticRef,
  };
  const drawing = useDrawing(drawingHookOptions);

  // Expose hook to parent on every render (parent stores in ref, no re-render loop)
  onDrawingHook?.(drawing);

  // Expose applyMessage to parent
  useEffect(() => {
    if (!onApplyMessage) return;
    onApplyMessage((msg: DrawMessage) => {
      if (staticRef.current) drawing.applyMessage(msg, staticRef.current);
    });
  }, [drawing, onApplyMessage]);

  // Expose getDataUrl to parent
  useEffect(() => {
    if (!onSnapshot) return;
    onSnapshot(() => staticRef.current?.toDataURL('image/png') ?? '');
  }, [onSnapshot]);

  // Expose clear to parent
  useEffect(() => {
    if (!onClear) return;
    onClear(() => {
      if (staticRef.current && overlayRef.current)
        drawing.clearCanvas(staticRef.current, overlayRef.current);
    });
  }, [drawing, onClear]);

  // Resize observer — save/restore static canvas content across resize (fullscreen etc.)
  useEffect(() => {
    const obs = new ResizeObserver(() => {
      const staticCanvas = staticRef.current;

      // 1. Snapshot existing content before dimensions reset
      let snapshot: string | null = null;
      if (staticCanvas && staticCanvas.width > 0 && staticCanvas.height > 0) {
        snapshot = staticCanvas.toDataURL();
      }

      // 2. Resize both canvases (clears them)
      if (staticCanvas) resizeCanvas(staticCanvas);
      if (overlayRef.current) resizeCanvas(overlayRef.current);

      // 3. Restore static canvas content scaled to new dimensions
      if (staticCanvas && snapshot) {
        const ctx = staticCanvas.getContext('2d');
        if (ctx) {
          const img = new Image();
          img.onload = () => ctx.drawImage(img, 0, 0, staticCanvas.width, staticCanvas.height);
          img.src = snapshot;
        }
      }
    });
    if (staticRef.current) obs.observe(staticRef.current);
    return () => obs.disconnect();
  }, []);

  // Animation loop for overlay
  const tick = useCallback(() => {
    if (overlayRef.current) drawing.renderOverlay(overlayRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [drawing]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [tick]);

  const commonCanvasStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    touchAction: 'none',
  };

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%', bgcolor: '#ffffff' }}>
      {/* Static layer — committed strokes */}
      <canvas ref={staticRef} style={commonCanvasStyle} />
      {/* Overlay layer — live preview, only interactive when not readOnly */}
      <canvas
        ref={overlayRef}
        style={{
          ...commonCanvasStyle,
          cursor: readOnly ? 'default' : 'crosshair',
          pointerEvents: readOnly ? 'none' : 'auto',
        }}
        onPointerDown={readOnly ? undefined : drawing.onPointerDown}
        onPointerMove={readOnly ? undefined : drawing.onPointerMove}
        onPointerUp={readOnly ? undefined : drawing.onPointerUp}
      />
    </Box>
  );
};

export default DrawingCanvas;
