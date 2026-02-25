import React, { useEffect, useRef, useCallback, useMemo } from 'react';
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

/** Generate a circle cursor data-URL for the eraser tool */
function makeEraserCursor(size: number): string {
  const r = Math.max(size / 2, 4);
  const d = Math.ceil(r * 2 + 2);
  const c = d / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}">` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(0,0,0,0.6)" stroke-width="1.5"/>` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="0.5"/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`;
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

  // Stable ref so effects don't re-run on every style change
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;

  // Expose hook to parent on every render (parent stores in ref, no re-render loop)
  onDrawingHook?.(drawing);

  // Expose applyMessage to parent
  useEffect(() => {
    if (!onApplyMessage) return;
    onApplyMessage((msg: DrawMessage) => {
      if (staticRef.current) drawingRef.current.applyMessage(msg, staticRef.current);
    });
  }, [onApplyMessage]);

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
        drawingRef.current.clearCanvas(staticRef.current, overlayRef.current);
    });
  }, [onClear]);

  // Prevent Safari/iPad from intercepting touch/pointer events as scroll gestures
  // + two-finger touch scrolling for iPad/tablet
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;

    // Mouse wheel → vertical scroll (works on all modes)
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const delta = e.deltaY / (rect.height || 1);
      drawingRef.current.scrollBy(delta);
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    // --- Two-finger touch scrolling (iPad / tablet) ---
    let lastTouchY: number | null = null;
    let isTwoFingerScroll = false;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
        isTwoFingerScroll = true;
        lastTouchY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        // Cancel any ongoing single-finger drawing
        if (!readOnly) drawingRef.current.onPointerCancel();
      } else if (!readOnly) {
        // Single touch in drawing mode: prevent browser scroll/zoom
        e.preventDefault();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2 && isTwoFingerScroll && lastTouchY !== null) {
        e.preventDefault();
        const currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = canvas.getBoundingClientRect();
        const delta = (lastTouchY - currentY) / (rect.height || 1);
        drawingRef.current.scrollBy(delta);
        lastTouchY = currentY;
      } else if (!readOnly) {
        e.preventDefault();
      }
    };

    const handleTouchEnd = () => {
      isTwoFingerScroll = false;
      lastTouchY = null;
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, [readOnly]);

  // Redraw static canvas from stroke objects when viewport scrolls
  const prevOffsetRef = useRef(drawing.viewportOffsetY);
  useEffect(() => {
    if (prevOffsetRef.current !== drawing.viewportOffsetY) {
      prevOffsetRef.current = drawing.viewportOffsetY;
      if (staticRef.current) drawingRef.current.redrawStatic(staticRef.current);
    }
  }, [drawing.viewportOffsetY]);

  // Resize observer — resize canvases and redraw from stroke objects (runs once)
  useEffect(() => {
    const obs = new ResizeObserver(() => {
      const staticCanvas = staticRef.current;

      // Resize both canvases (clears them)
      if (staticCanvas) resizeCanvas(staticCanvas);
      if (overlayRef.current) resizeCanvas(overlayRef.current);

      // Redraw from stroke objects at current viewport
      if (staticCanvas) drawingRef.current.redrawStatic(staticCanvas);
    });
    if (staticRef.current) obs.observe(staticRef.current);
    return () => obs.disconnect();
  }, []);

  // Animation loop for overlay
  const tick = useCallback(() => {
    if (overlayRef.current) drawingRef.current.renderOverlay(overlayRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

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

  // Eraser: dynamic circle cursor; other tools: crosshair
  const eraserCursor = useMemo(() => {
    if (readOnly) return 'default';
    if (drawing.style.tool === 'eraser' || drawing.style.tool === 'pixel_eraser')
      return makeEraserCursor(drawing.style.width);
    return 'crosshair';
  }, [readOnly, drawing.style.tool, drawing.style.width]);

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%', bgcolor: '#ffffff' }}>
      {/* Static layer — committed strokes */}
      <canvas ref={staticRef} style={commonCanvasStyle} />
      {/* Overlay layer — live preview; accepts wheel events in all modes, pointer events only when interactive */}
      <canvas
        ref={overlayRef}
        style={{
          ...commonCanvasStyle,
          cursor: readOnly ? 'default' : eraserCursor,
        }}
        onPointerDown={readOnly ? undefined : drawing.onPointerDown}
        onPointerMove={readOnly ? undefined : drawing.onPointerMove}
        onPointerUp={readOnly ? undefined : drawing.onPointerUp}
        onPointerCancel={readOnly ? undefined : drawing.onPointerCancel}
      />
    </Box>
  );
};

export default DrawingCanvas;
