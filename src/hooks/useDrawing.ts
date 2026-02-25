import React, { useCallback, useRef, useState } from 'react';
import type { DrawMessage, DrawStyle, Point, StrokeObject, Tool } from '../types/drawing';

export interface UseDrawingOptions {
  onStrokeMessage?: (msg: DrawMessage) => void;
  staticCanvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

export interface UseDrawingReturn {
  style: DrawStyle;
  viewportOffsetY: number;
  setTool: (tool: Tool) => void;
  setColor: (color: string) => void;
  setWidth: (width: number) => void;
  onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerCancel: () => void;
  applyMessage: (msg: DrawMessage, staticCanvas: HTMLCanvasElement) => void;
  clearCanvas: (staticCanvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement) => void;
  renderOverlay: (overlayCanvas: HTMLCanvasElement) => void;
  /** Scroll the viewport by delta (in world-space units where 1.0 = one screen height) */
  scrollBy: (deltaY: number) => void;
  /** Redraw the static canvas from stroke objects at current viewport */
  redrawStatic: (canvas: HTMLCanvasElement) => void;
  /** Render all strokes across full vertical extent and return a white-background PNG data URL */
  getFullSnapshot: (screenCanvas: HTMLCanvasElement) => string;
  /** Return a copy of the current stroke objects for sync */
  getStrokes: () => StrokeObject[];
}

let _strokeCounter = 0;
function nextStrokeId(): string {
  return `s${Date.now()}-${++_strokeCounter}`;
}

// ─── Drawing helpers ─────────────────────────────────────────────

function catmullRomPoint(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  canvas: HTMLCanvasElement,
  viewportOffsetY = 0,
  tension = 0.5
) {
  if (points.length < 2) return;
  const pts = points.map((p) => ({
    x: p.x * canvas.width,
    y: (p.y - viewportOffsetY) * canvas.height,
  }));
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

function getCanvasPoint(clientX: number, clientY: number, pressure: number, rect: DOMRect, viewportOffsetY: number): Point {
  return {
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top) / rect.height + viewportOffsetY,
    pressure: pressure ?? 0.5,
  };
}

function applyStrokeStyle(ctx: CanvasRenderingContext2D, style: DrawStyle, pressure = 0.5) {
  const dpr = window.devicePixelRatio || 1;
  const width = style.width * dpr * (0.5 + pressure * 0.8);
  if (style.tool === 'pixel_eraser') {
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

function drawShape(
  ctx: CanvasRenderingContext2D,
  style: DrawStyle,
  start: Point,
  end: Point,
  canvas: HTMLCanvasElement,
  viewportOffsetY = 0
) {
  const dpr = window.devicePixelRatio || 1;
  const sx = start.x * canvas.width;
  const sy = (start.y - viewportOffsetY) * canvas.height;
  const ex = end.x * canvas.width;
  const ey = (end.y - viewportOffsetY) * canvas.height;
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

// ─── Stroke object rendering ────────────────────────────────────

function renderStroke(ctx: CanvasRenderingContext2D, stroke: StrokeObject, canvas: HTMLCanvasElement, viewportOffsetY = 0) {
  if (stroke.points.length < 2) return;
  if (stroke.tool === 'line' || stroke.tool === 'rect') {
    drawShape(ctx, stroke.style, stroke.points[0], stroke.points[stroke.points.length - 1], canvas, viewportOffsetY);
  } else {
    const lastPt = stroke.points[stroke.points.length - 1];
    applyStrokeStyle(ctx, stroke.style, lastPt.pressure ?? 0.5);
    catmullRomPoint(ctx, stroke.points, canvas, viewportOffsetY);
    ctx.stroke();
  }
}

function redrawAll(strokes: StrokeObject[], canvas: HTMLCanvasElement, viewportOffsetY = 0) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of strokes) {
    renderStroke(ctx, s, canvas, viewportOffsetY);
  }
}

// ─── Hit testing for stroke eraser ──────────────────────────────

/** Distance from point P to the closest point on segment AB (all in normalized 0-1 coords) */
function pointToSegmentDist(p: Point, a: Point, b: Point, aspect: number): number {
  const ax = a.x, ay = a.y * aspect, bx = b.x, by = b.y * aspect;
  const px = p.x, py = p.y * aspect;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Check if a point (normalized) is close enough to any segment of a stroke */
function hitTestStroke(stroke: StrokeObject, point: Point, threshold: number, aspect: number): boolean {
  const pts = stroke.points;
  for (let i = 0; i < pts.length - 1; i++) {
    if (pointToSegmentDist(point, pts[i], pts[i + 1], aspect) < threshold) return true;
  }
  // Single-point strokes
  if (pts.length === 1) {
    const dx = point.x - pts[0].x;
    const dy = (point.y - pts[0].y) * aspect;
    return Math.hypot(dx, dy) < threshold;
  }
  return false;
}

// ─── Hook ───────────────────────────────────────────────────────

export function useDrawing({ onStrokeMessage, staticCanvasRef }: UseDrawingOptions): UseDrawingReturn {
  const [style, setStyle] = useState<DrawStyle>({ tool: 'pen', color: '#000000', width: 4 });
  const styleRef = useRef(style);
  styleRef.current = style;

  const staticCanvasRefRef = useRef(staticCanvasRef);
  staticCanvasRefRef.current = staticCanvasRef;

  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef<Point[]>([]);
  const pendingBatchRef = useRef<Point[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shapeStartRef = useRef<Point | null>(null);
  const shapeEndRef = useRef<Point | null>(null);
  const currentStrokeIdRef = useRef<string>('');
  const activePointerIdRef = useRef<number | null>(null);

  // Stroke object store — shared across local and remote operations
  const strokesRef = useRef<StrokeObject[]>([]);

  // Remote stroke assembly (keyed by strokeId or fallback key)
  const remoteStrokeRef = useRef<{ style: DrawStyle; points: Point[]; strokeId: string } | null>(null);

  // Viewport for infinite canvas (Y offset in world units; 1.0 = one screen height)
  const [viewportOffsetY, setViewportOffsetY] = useState(0);
  const viewportOffsetYRef = useRef(viewportOffsetY);
  viewportOffsetYRef.current = viewportOffsetY;

  const setTool = useCallback((tool: Tool) => setStyle((s) => ({ ...s, tool })), []);
  const setColor = useCallback((color: string) => setStyle((s) => ({ ...s, color })), []);
  const setWidth = useCallback((width: number) => setStyle((s) => ({ ...s, width })), []);

  const flushBatch = useCallback(() => {
    if (pendingBatchRef.current.length === 0) return;
    const pts = pendingBatchRef.current.splice(0);
    onStrokeMessage?.({ type: 'stroke_move', points: pts });
  }, [onStrokeMessage]);

  // ── Eraser logic ──────────────────────────────────────────

  const eraserDeletedRef = useRef<Set<string>>(new Set());

  const handleEraserMove = useCallback(
    (point: Point, canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / (rect.height || 1);
      // threshold in normalized space: eraser width / canvas CSS width
      const threshold = (styleRef.current.width * 1.5) / rect.width;
      let needsRedraw = false;

      for (let i = strokesRef.current.length - 1; i >= 0; i--) {
        const s = strokesRef.current[i];
        if (eraserDeletedRef.current.has(s.id)) continue;
        if (hitTestStroke(s, point, threshold, aspect)) {
          eraserDeletedRef.current.add(s.id);
          strokesRef.current.splice(i, 1);
          needsRedraw = true;
          onStrokeMessage?.({ type: 'stroke_delete', strokeId: s.id });
        }
      }

      if (needsRedraw) {
        redrawAll(strokesRef.current, canvas, viewportOffsetYRef.current);
      }
    },
    [onStrokeMessage]
  );

  // ── Pointer handlers ──────────────────────────────────────

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Only track one pointer — reject multi-touch
      if (activePointerIdRef.current !== null && isDrawingRef.current) return;
      activePointerIdRef.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      const point = getCanvasPoint(e.clientX, e.clientY, e.pressure, rect, viewportOffsetYRef.current);
      isDrawingRef.current = true;

      const tool = styleRef.current.tool;
      if (tool === 'eraser') {
        eraserDeletedRef.current.clear();
        handleEraserMove(point, staticCanvasRefRef.current?.current ?? null);
        return;
      }
      if (tool === 'line' || tool === 'rect') {
        shapeStartRef.current = point;
        shapeEndRef.current = null;
      } else {
        currentStrokeIdRef.current = nextStrokeId();
        currentPointsRef.current = [point];
        pendingBatchRef.current = [point];
        onStrokeMessage?.({ type: 'stroke_start', style: styleRef.current, point, strokeId: currentStrokeIdRef.current });
      }
    },
    [onStrokeMessage, handleEraserMove]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return;
      if (e.pointerId !== activePointerIdRef.current) return;
      const tool = styleRef.current.tool;
      const canvas = e.currentTarget;
      const rect = canvas.getBoundingClientRect();

      if (tool === 'eraser') {
        const point = getCanvasPoint(e.clientX, e.clientY, e.pressure, rect, viewportOffsetYRef.current);
        handleEraserMove(point, staticCanvasRefRef.current?.current ?? null);
        return;
      }

      if (tool === 'line' || tool === 'rect') {
        shapeEndRef.current = getCanvasPoint(e.clientX, e.clientY, e.pressure, rect, viewportOffsetYRef.current);
        return;
      }

      const coalescedEvents = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ce of coalescedEvents) {
        const point = getCanvasPoint(ce.clientX, ce.clientY, ce.pressure, rect, viewportOffsetYRef.current);
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
    [flushBatch, handleEraserMove]
  );

  const onPointerCancel = useCallback(() => {
    activePointerIdRef.current = null;
    isDrawingRef.current = false;
    currentPointsRef.current = [];
    pendingBatchRef.current = [];
    shapeStartRef.current = null;
    shapeEndRef.current = null;
    eraserDeletedRef.current.clear();
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return;
      if (e.pointerId !== activePointerIdRef.current) return;
      isDrawingRef.current = false;
      activePointerIdRef.current = null;
      const rect = e.currentTarget.getBoundingClientRect();
      const point = getCanvasPoint(e.clientX, e.clientY, e.pressure, rect, viewportOffsetYRef.current);
      const tool = styleRef.current.tool;
      const staticCanvas = staticCanvasRefRef.current?.current ?? null;

      if (tool === 'eraser') {
        eraserDeletedRef.current.clear();
        return;
      }

      if (tool === 'line' || tool === 'rect') {
        const startPoint = shapeStartRef.current;
        if (startPoint && staticCanvas) {
          const strokeId = nextStrokeId();
          const stroke: StrokeObject = {
            id: strokeId,
            tool,
            style: { ...styleRef.current },
            points: [startPoint, point],
          };
          strokesRef.current.push(stroke);

          const ctx = staticCanvas.getContext('2d');
          if (ctx) drawShape(ctx, styleRef.current, startPoint, point, staticCanvas, viewportOffsetYRef.current);

          const overlayCtx = e.currentTarget.getContext('2d');
          overlayCtx?.clearRect(0, 0, e.currentTarget.width, e.currentTarget.height);
          shapeStartRef.current = null;
          shapeEndRef.current = null;

          onStrokeMessage?.({ type: 'stroke_start', style: styleRef.current, point: startPoint, strokeId });
          onStrokeMessage?.({ type: 'stroke_move', points: [point] });
          onStrokeMessage?.({ type: 'stroke_end' });
        }
      } else {
        if (batchTimerRef.current) {
          clearTimeout(batchTimerRef.current);
          batchTimerRef.current = null;
        }
        flushBatch();

        const pts = currentPointsRef.current;
        if (staticCanvas && pts.length >= 2) {
          const stroke: StrokeObject = {
            id: currentStrokeIdRef.current,
            tool,
            style: { ...styleRef.current },
            points: [...pts],
          };
          strokesRef.current.push(stroke);

          const ctx = staticCanvas.getContext('2d');
          if (ctx) {
            applyStrokeStyle(ctx, styleRef.current, pts[pts.length - 1]?.pressure ?? 0.5);
            catmullRomPoint(ctx, pts, staticCanvas, viewportOffsetYRef.current);
            ctx.stroke();
          }
        }
        currentPointsRef.current = [];
        onStrokeMessage?.({ type: 'stroke_end' });
      }
    },
    [flushBatch, onStrokeMessage]
  );

  // ── Overlay ───────────────────────────────────────────────

  const renderOverlay = useCallback(
    (overlayCanvas: HTMLCanvasElement) => {
      const ctx = overlayCanvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

      const tool = styleRef.current.tool;
      if ((tool === 'line' || tool === 'rect') && shapeStartRef.current && shapeEndRef.current) {
        drawShape(ctx, styleRef.current, shapeStartRef.current, shapeEndRef.current, overlayCanvas, viewportOffsetYRef.current);
        return;
      }

      if (tool === 'eraser') return;

      const pts = currentPointsRef.current;
      if (pts.length < 2) return;

      if (tool === 'pixel_eraser') {
        // Preview pixel eraser as semi-transparent indicator (actual erase on commit)
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
        const dpr = window.devicePixelRatio || 1;
        ctx.lineWidth = styleRef.current.width * dpr;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      } else {
        applyStrokeStyle(ctx, styleRef.current, pts[pts.length - 1].pressure ?? 0.5);
      }
      catmullRomPoint(ctx, pts, overlayCanvas, viewportOffsetYRef.current);
      ctx.stroke();
    },
    []
  );

  // ── Apply remote messages ─────────────────────────────────

  const applyMessage = useCallback(
    (msg: DrawMessage, staticCanvas: HTMLCanvasElement) => {
      const ctx = staticCanvas.getContext('2d');
      if (!ctx) return;

      switch (msg.type) {
        case 'stroke_start': {
          remoteStrokeRef.current = {
            style: msg.style,
            points: [msg.point],
            strokeId: msg.strokeId || nextStrokeId(),
          };
          break;
        }
        case 'stroke_move': {
          const remote = remoteStrokeRef.current;
          if (!remote) break;
          remote.points.push(...msg.points);
          if (remote.style.tool === 'line' || remote.style.tool === 'rect') {
            // Don't redraw intermediate for shapes; wait for stroke_end
          } else {
            applyStrokeStyle(ctx, remote.style, msg.points[msg.points.length - 1]?.pressure ?? 0.5);
            catmullRomPoint(ctx, remote.points, staticCanvas, viewportOffsetYRef.current);
            ctx.stroke();
          }
          break;
        }
        case 'stroke_end': {
          const remote = remoteStrokeRef.current;
          if (!remote) break;
          if (remote.style.tool === 'line' || remote.style.tool === 'rect') {
            drawShape(ctx, remote.style, remote.points[0], remote.points[remote.points.length - 1], staticCanvas, viewportOffsetYRef.current);
          }
          // Store as stroke object
          strokesRef.current.push({
            id: remote.strokeId,
            tool: remote.style.tool,
            style: remote.style,
            points: [...remote.points],
          });
          remoteStrokeRef.current = null;
          break;
        }
        case 'stroke_delete': {
          const idx = strokesRef.current.findIndex((s) => s.id === msg.strokeId);
          if (idx !== -1) {
            strokesRef.current.splice(idx, 1);
            redrawAll(strokesRef.current, staticCanvas, viewportOffsetYRef.current);
          }
          break;
        }
        case 'clear':
          ctx.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
          strokesRef.current = [];
          break;
        case 'snapshot': {
          const img = new Image();
          img.onload = () => {
            // Scale to match canvas width, preserving aspect ratio
            const scale = staticCanvas.width / img.naturalWidth;
            ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight,
              0, 0, staticCanvas.width, img.naturalHeight * scale);
          };
          img.src = msg.dataUrl;
          // Snapshot replaces stroke history (cannot reconstruct objects from raster)
          strokesRef.current = [];
          break;
        }
        case 'sync_strokes': {
          strokesRef.current = msg.strokes;
          redrawAll(strokesRef.current, staticCanvas, viewportOffsetYRef.current);
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
      strokesRef.current = [];
    },
    []
  );

  const scrollBy = useCallback(
    (deltaY: number) => {
      setViewportOffsetY((prev) => {
        const next = Math.max(0, prev + deltaY);
        viewportOffsetYRef.current = next;
        return next;
      });
    },
    []
  );

  const redrawStatic = useCallback(
    (canvas: HTMLCanvasElement) => {
      redrawAll(strokesRef.current, canvas, viewportOffsetYRef.current);
    },
    []
  );

  const getFullSnapshot = useCallback(
    (screenCanvas: HTMLCanvasElement): string => {
      const strokes = strokesRef.current;
      const screenW = screenCanvas.width;
      const screenH = screenCanvas.height;
      const tmp = document.createElement('canvas');
      const ctx = tmp.getContext('2d')!;

      if (strokes.length === 0) {
        // No stroke objects (blank canvas or raster-only snapshot) — composite current view with white bg
        tmp.width = screenW;
        tmp.height = screenH;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, screenW, screenH);
        ctx.drawImage(screenCanvas, 0, 0);
        return tmp.toDataURL('image/png');
      }

      // Find the vertical extent of all strokes in world-space units
      let maxWorldY = 1;
      for (const s of strokes) {
        for (const p of s.points) {
          if (p.y > maxWorldY) maxWorldY = p.y;
        }
      }
      maxWorldY += 0.05; // small bottom padding

      // Full canvas: same width, taller by the world extent
      tmp.width = screenW;
      tmp.height = Math.ceil(maxWorldY * screenH);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, tmp.width, tmp.height);

      // Render all strokes using screen dimensions as the coordinate scale unit.
      // renderStroke maps: canvasX = point.x * canvas.width
      //                    canvasY = (point.y - viewportOffsetY) * canvas.height
      // By passing a virtual canvas with screenW/screenH and viewportOffsetY=0,
      // each stroke is placed at its absolute pixel position in world space.
      const vCanvas = { width: screenW, height: screenH } as unknown as HTMLCanvasElement;
      for (const s of strokes) {
        renderStroke(ctx, s, vCanvas, 0);
      }

      return tmp.toDataURL('image/png');
    },
    []
  );

  const getStrokes = useCallback(
    (): StrokeObject[] => [...strokesRef.current],
    []
  );

  return {
    style,
    viewportOffsetY,
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
    scrollBy,
    redrawStatic,
    getFullSnapshot,
    getStrokes,
  };
}
