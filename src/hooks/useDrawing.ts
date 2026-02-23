import React, { useCallback, useRef, useState } from 'react';
import type { DrawMessage, DrawStyle, Point, Tool } from '../types/drawing';

export interface UseDrawingOptions {
  onStrokeMessage?: (msg: DrawMessage) => void;
  // Pass the static canvas ref so strokes are committed locally on pointer-up
  staticCanvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

export interface UseDrawingReturn {
  style: DrawStyle;
  setTool: (tool: Tool) => void;
  setColor: (color: string) => void;
  setWidth: (width: number) => void;
  // Canvas event handlers (attach to the top overlay canvas)
  onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerCancel: () => void;
  // Apply an incoming DrawMessage onto the static canvas
  applyMessage: (msg: DrawMessage, staticCanvas: HTMLCanvasElement) => void;
  // Clear both canvases
  clearCanvas: (staticCanvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement) => void;
  // Render current stroke preview onto overlay canvas
  renderOverlay: (overlayCanvas: HTMLCanvasElement) => void;
}

// Catmull-Rom spline helper — points are normalized (0-1), canvas used to denormalize
function catmullRomPoint(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  canvas: HTMLCanvasElement,
  tension = 0.5
) {
  if (points.length < 2) return;
  const pts = points.map((p) => ({ x: p.x * canvas.width, y: p.y * canvas.height }));
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const cp1x = p1.x + ((p2.x - p0.x) * tension) / 3;
    const cp1y = p1.y + ((p2.y - p0.y) * tension) / 3;
    const cp2x = p2.x - ((p3.x - p1.x) * tension) / 3;
    const cp2y = p2.y - ((p3.y - p1.y) * tension) / 3;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

// Returns normalized (0-1) coordinates — device/size independent
function getCanvasPoint(clientX: number, clientY: number, pressure: number, rect: DOMRect): Point {
  return {
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top) / rect.height,
    pressure: pressure ?? 0.5,
  };
}

// style.width is in CSS px; scale by DPR so thickness is consistent across devices
function applyStrokeStyle(
  ctx: CanvasRenderingContext2D,
  style: DrawStyle,
  pressure = 0.5
) {
  const dpr = window.devicePixelRatio || 1;
  const width = style.width * dpr * (0.5 + pressure * 0.8);
  if (style.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = style.color;
  }
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

// start/end are normalized (0-1); canvas used to denormalize
function drawShape(
  ctx: CanvasRenderingContext2D,
  style: DrawStyle,
  start: Point,
  end: Point,
  canvas: HTMLCanvasElement
) {
  const dpr = window.devicePixelRatio || 1;
  const sx = start.x * canvas.width;
  const sy = start.y * canvas.height;
  const ex = end.x * canvas.width;
  const ey = end.y * canvas.height;
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width * dpr;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (style.tool === 'line') {
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  } else {
    ctx.strokeRect(sx, sy, ex - sx, ey - sy);
  }
}

export function useDrawing({ onStrokeMessage, staticCanvasRef }: UseDrawingOptions): UseDrawingReturn {
  const [style, setStyle] = useState<DrawStyle>({
    tool: 'pen',
    color: '#000000',
    width: 4,
  });

  const styleRef = useRef(style);
  styleRef.current = style;

  // Keep a stable ref to the latest staticCanvasRef prop
  const staticCanvasRefRef = useRef(staticCanvasRef);
  staticCanvasRefRef.current = staticCanvasRef;

  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef<Point[]>([]);
  const pendingBatchRef = useRef<Point[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shapeStartRef = useRef<Point | null>(null);
  // Shape preview end point (no DOM property hacking)
  const shapeEndRef = useRef<Point | null>(null);

  const setTool = useCallback((tool: Tool) => setStyle((s) => ({ ...s, tool })), []);
  const setColor = useCallback((color: string) => setStyle((s) => ({ ...s, color })), []);
  const setWidth = useCallback((width: number) => setStyle((s) => ({ ...s, width })), []);

  const flushBatch = useCallback(() => {
    if (pendingBatchRef.current.length === 0) return;
    const pts = pendingBatchRef.current.splice(0);
    onStrokeMessage?.({ type: 'stroke_move', points: pts });
    // Note: currentPointsRef is updated immediately in onPointerMove for local rendering
  }, [onStrokeMessage]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      const point = getCanvasPoint(e.clientX, e.clientY, e.pressure, rect);
      isDrawingRef.current = true;

      const tool = styleRef.current.tool;
      if (tool === 'line' || tool === 'rect') {
        shapeStartRef.current = point;
        shapeEndRef.current = null;
      } else {
        currentPointsRef.current = [point];
        pendingBatchRef.current = [point];
        onStrokeMessage?.({ type: 'stroke_start', style: styleRef.current, point });
      }
    },
    [onStrokeMessage]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return;
      const tool = styleRef.current.tool;
      const canvas = e.currentTarget;
      const rect = canvas.getBoundingClientRect();

      if (tool === 'line' || tool === 'rect') {
        shapeEndRef.current = getCanvasPoint(e.clientX, e.clientY, e.pressure, rect);
        return;
      }

      // Use coalesced events for smoother Apple Pencil / stylus tracking
      const coalescedEvents = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ce of coalescedEvents) {
        const point = getCanvasPoint(ce.clientX, ce.clientY, ce.pressure, rect);
        // Push immediately to currentPointsRef so renderOverlay reflects it without delay
        currentPointsRef.current.push(point);
        pendingBatchRef.current.push(point);
      }

      if (!batchTimerRef.current) {
        batchTimerRef.current = setTimeout(() => {
          batchTimerRef.current = null;
          flushBatch();
        }, 16);
      }
    },
    [flushBatch]
  );

  const onPointerCancel = useCallback(() => {
    // Reset all drawing state when the pointer is cancelled (e.g. system intercepts touch)
    isDrawingRef.current = false;
    currentPointsRef.current = [];
    pendingBatchRef.current = [];
    shapeStartRef.current = null;
    shapeEndRef.current = null;
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      const rect = e.currentTarget.getBoundingClientRect();
      const point = getCanvasPoint(e.clientX, e.clientY, e.pressure, rect);
      const tool = styleRef.current.tool;
      const staticCanvas = staticCanvasRefRef.current?.current ?? null;

      if (tool === 'line' || tool === 'rect') {
        const startPoint = shapeStartRef.current;
        if (startPoint) {
          // Commit shape to local static canvas
          if (staticCanvas) {
            const ctx = staticCanvas.getContext('2d');
            if (ctx) drawShape(ctx, styleRef.current, startPoint, point, staticCanvas);
          }
          // Clear overlay
          const overlayCtx = e.currentTarget.getContext('2d');
          overlayCtx?.clearRect(0, 0, e.currentTarget.width, e.currentTarget.height);
          shapeStartRef.current = null;
          shapeEndRef.current = null;
          // Send shape for remote replay
          onStrokeMessage?.({ type: 'stroke_start', style: styleRef.current, point: startPoint });
          onStrokeMessage?.({ type: 'stroke_move', points: [point] });
          onStrokeMessage?.({ type: 'stroke_end' });
        }
      } else {
        if (batchTimerRef.current) {
          clearTimeout(batchTimerRef.current);
          batchTimerRef.current = null;
        }
        flushBatch();
        // ── KEY FIX: commit the full stroke to local static canvas ──
        const pts = currentPointsRef.current;
        if (staticCanvas && pts.length >= 2) {
          const ctx = staticCanvas.getContext('2d');
          if (ctx) {
            applyStrokeStyle(ctx, styleRef.current, pts[pts.length - 1]?.pressure ?? 0.5);
            catmullRomPoint(ctx, pts, staticCanvas);
            ctx.stroke();
          }
        }
        currentPointsRef.current = [];
        onStrokeMessage?.({ type: 'stroke_end' });
      }
    },
    [flushBatch, onStrokeMessage]
  );

  const renderOverlay = useCallback(
    (overlayCanvas: HTMLCanvasElement) => {
      const ctx = overlayCanvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

      const tool = styleRef.current.tool;
      if ((tool === 'line' || tool === 'rect') && shapeStartRef.current && shapeEndRef.current) {
        drawShape(ctx, styleRef.current, shapeStartRef.current, shapeEndRef.current, overlayCanvas);
        return;
      }

      const pts = currentPointsRef.current;
      if (pts.length < 2) return;
      applyStrokeStyle(ctx, styleRef.current, pts[pts.length - 1].pressure ?? 0.5);
      catmullRomPoint(ctx, pts, overlayCanvas);
      ctx.stroke();
    },
    []
  );

  const applyMessage = useCallback(
    (msg: DrawMessage, staticCanvas: HTMLCanvasElement) => {
      const ctx = staticCanvas.getContext('2d');
      if (!ctx) return;

      switch (msg.type) {
        case 'stroke_start': {
          // store style and first point (normalized); actual drawing starts at stroke_move
          (staticCanvas as never as { _remoteStyle: DrawStyle })._remoteStyle = msg.style;
          (staticCanvas as never as { _remotePoints: Point[] })._remotePoints = [msg.point];
          break;
        }
        case 'stroke_move': {
          const remoteStyle = (staticCanvas as never as { _remoteStyle: DrawStyle })._remoteStyle;
          const remotePoints = (staticCanvas as never as { _remotePoints: Point[] })._remotePoints ?? [];
          remotePoints.push(...msg.points);
          (staticCanvas as never as { _remotePoints: Point[] })._remotePoints = remotePoints;
          if (remoteStyle) {
            if (remoteStyle.tool === 'line' || remoteStyle.tool === 'rect') {
              drawShape(ctx, remoteStyle, remotePoints[0], remotePoints[remotePoints.length - 1], staticCanvas);
            } else {
              applyStrokeStyle(ctx, remoteStyle, msg.points[msg.points.length - 1]?.pressure ?? 0.5);
              catmullRomPoint(ctx, remotePoints, staticCanvas);
              ctx.stroke();
            }
          }
          break;
        }
        case 'stroke_end':
          break;
        case 'clear':
          ctx.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
          break;
        case 'snapshot': {
          const img = new Image();
          img.onload = () => ctx.drawImage(img, 0, 0, staticCanvas.width, staticCanvas.height);
          img.src = msg.dataUrl;
          break;
        }
        default:
          break;
      }
    },
    []
  );

  const clearCanvas = useCallback(
    (staticCanvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement) => {
      const sCtx = staticCanvas.getContext('2d');
      const oCtx = overlayCanvas.getContext('2d');
      sCtx?.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
      oCtx?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    },
    []
  );

  return {
    style,
    setTool,
    setColor,
    setWidth,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    applyMessage,
    clearCanvas,
    renderOverlay,
  };
}
