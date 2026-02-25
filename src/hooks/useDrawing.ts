import React, { useCallback, useRef, useState } from 'react';
import type { DrawMessage, DrawStyle, ImageObject, Point, StrokeObject, Tool } from '../types/drawing';

export interface UseDrawingOptions {
  onStrokeMessage?: (msg: DrawMessage) => void;
  staticCanvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

export interface UseDrawingReturn {
  style: DrawStyle;
  viewportOffsetY: number;
  hasPendingImage: boolean;
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
  scrollBy: (deltaY: number) => void;
  redrawStatic: (canvas: HTMLCanvasElement) => void;
  getFullSnapshot: (screenCanvas: HTMLCanvasElement) => string;
  getStrokes: () => StrokeObject[];
  getImages: () => ImageObject[];
  handlePasteImage: (dataUrl: string) => void;
  cancelPendingAction: () => void;
}

let _strokeCounter = 0;
function nextStrokeId(): string {
  return `s${Date.now()}-${++_strokeCounter}`;
}

let _imageCounter = 0;
function nextImageId(): string {
  return `img${Date.now()}-${++_imageCounter}`;
}

// --- Drawing helpers ---------------------------------------------------------

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

// --- Stroke / image rendering ------------------------------------------------

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

function renderImage(
  ctx: CanvasRenderingContext2D,
  img: ImageObject,
  el: HTMLImageElement,
  canvas: HTMLCanvasElement,
  viewportOffsetY: number,
) {
  const px = img.x * canvas.width;
  const py = (img.y - viewportOffsetY) * canvas.height;
  const pw = img.width * canvas.width;
  const ph = img.height * canvas.height;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(el, px, py, pw, ph);
}

function redrawAll(
  strokes: StrokeObject[],
  images: ImageObject[],
  imageCache: Map<string, HTMLImageElement>,
  canvas: HTMLCanvasElement,
  viewportOffsetY = 0,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const img of images) {
    const el = imageCache.get(img.id);
    if (el) renderImage(ctx, img, el, canvas, viewportOffsetY);
  }
  for (const s of strokes) {
    renderStroke(ctx, s, canvas, viewportOffsetY);
  }
}

// --- Hit testing for stroke eraser -------------------------------------------

function pointToSegmentDist(p: Point, a: Point, b: Point, aspect: number): number {
  const ax = a.x, ay = a.y * aspect, bx = b.x, by = b.y * aspect;
  const px = p.x, py = p.y * aspect;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function hitTestStroke(stroke: StrokeObject, point: Point, threshold: number, aspect: number): boolean {
  const pts = stroke.points;
  for (let i = 0; i < pts.length - 1; i++) {
    if (pointToSegmentDist(point, pts[i], pts[i + 1], aspect) < threshold) return true;
  }
  if (pts.length === 1) {
    const dx = point.x - pts[0].x;
    const dy = (point.y - pts[0].y) * aspect;
    return Math.hypot(dx, dy) < threshold;
  }
  return false;
}

// --- Bounding-box helpers for selection --------------------------------------

interface BBox { minX: number; minY: number; maxX: number; maxY: number }

function getStrokeBBox(s: StrokeObject): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of s.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function getImageBBox(img: ImageObject): BBox {
  return { minX: img.x, minY: img.y, maxX: img.x + img.width, maxY: img.y + img.height };
}

function bboxOverlap(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function pointInBBox(p: Point, b: BBox): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number): BBox {
  return {
    minX: Math.min(x1, x2), minY: Math.min(y1, y2),
    maxX: Math.max(x1, x2), maxY: Math.max(y1, y2),
  };
}

function combinedBBox(ids: Set<string>, strokes: StrokeObject[], images: ImageObject[]): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;
  for (const s of strokes) {
    if (!ids.has(s.id)) continue;
    found = true;
    const bb = getStrokeBBox(s);
    if (bb.minX < minX) minX = bb.minX;
    if (bb.minY < minY) minY = bb.minY;
    if (bb.maxX > maxX) maxX = bb.maxX;
    if (bb.maxY > maxY) maxY = bb.maxY;
  }
  for (const img of images) {
    if (!ids.has(img.id)) continue;
    found = true;
    const bb = getImageBBox(img);
    if (bb.minX < minX) minX = bb.minX;
    if (bb.minY < minY) minY = bb.minY;
    if (bb.maxX > maxX) maxX = bb.maxX;
    if (bb.maxY > maxY) maxY = bb.maxY;
  }
  return found ? { minX, minY, maxX, maxY } : null;
}

// --- Hook --------------------------------------------------------------------

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

  const strokesRef = useRef<StrokeObject[]>([]);
  const remoteStrokeRef = useRef<{ style: DrawStyle; points: Point[]; strokeId: string } | null>(null);

  // Image store
  const imagesRef = useRef<ImageObject[]>([]);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Pending image placement
  const pendingImageRef = useRef<{
    id: string; src: string; width: number; height: number;
    x: number; y: number; el: HTMLImageElement;
  } | null>(null);
  const [hasPendingImage, setHasPendingImage] = useState(false);

  // Selection state
  const selectPhaseRef = useRef<'idle' | 'selecting' | 'selected' | 'moving'>('idle');
  const selectStartRef = useRef<Point | null>(null);
  const selectEndRef = useRef<Point | null>(null);
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const moveStartRef = useRef<Point | null>(null);
  const moveDeltaRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const movingStrokesRef = useRef<StrokeObject[]>([]);
  const movingImagesRef = useRef<ImageObject[]>([]);

  const [viewportOffsetY, setViewportOffsetY] = useState(0);
  const viewportOffsetYRef = useRef(viewportOffsetY);
  viewportOffsetYRef.current = viewportOffsetY;

  const eraserDeletedRef = useRef<Set<string>>(new Set());

  // -- Internal helpers -------------------------------------------------------

  const clearSelectionInternal = useCallback(() => {
    if (movingStrokesRef.current.length > 0) {
      strokesRef.current.push(...movingStrokesRef.current);
      movingStrokesRef.current = [];
    }
    if (movingImagesRef.current.length > 0) {
      imagesRef.current.push(...movingImagesRef.current);
      movingImagesRef.current = [];
    }
    selectedIdsRef.current.clear();
    selectPhaseRef.current = 'idle';
    selectStartRef.current = null;
    selectEndRef.current = null;
    moveStartRef.current = null;
    moveDeltaRef.current = { dx: 0, dy: 0 };
  }, []);

  const setTool = useCallback((tool: Tool) => {
    if (styleRef.current.tool === 'select' && tool !== 'select') {
      clearSelectionInternal();
      const canvas = staticCanvasRefRef.current?.current;
      if (canvas) redrawAll(strokesRef.current, imagesRef.current, imageCacheRef.current, canvas, viewportOffsetYRef.current);
    }
    setStyle((s) => ({ ...s, tool }));
  }, [clearSelectionInternal]);

  const setColor = useCallback((color: string) => setStyle((s) => ({ ...s, color })), []);
  const setWidth = useCallback((width: number) => setStyle((s) => ({ ...s, width })), []);

  const flushBatch = useCallback(() => {
    if (pendingBatchRef.current.length === 0) return;
    const pts = pendingBatchRef.current.splice(0);
    onStrokeMessage?.({ type: 'stroke_move', points: pts });
  }, [onStrokeMessage]);

  // -- Eraser -----------------------------------------------------------------

  const handleEraserMove = useCallback(
    (point: Point, canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const aspect = rect.width / (rect.height || 1);
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

      // Also hit-test images (eraser touches image bounding box → delete it)
      for (let i = imagesRef.current.length - 1; i >= 0; i--) {
        const img = imagesRef.current[i];
        if (eraserDeletedRef.current.has(img.id)) continue;
        const bb = getImageBBox(img);
        if (pointInBBox(point, bb)) {
          eraserDeletedRef.current.add(img.id);
          imagesRef.current.splice(i, 1);
          imageCacheRef.current.delete(img.id);
          needsRedraw = true;
          onStrokeMessage?.({ type: 'image_delete', imageId: img.id });
        }
      }

      if (needsRedraw) {
        redrawAll(strokesRef.current, imagesRef.current, imageCacheRef.current, canvas, viewportOffsetYRef.current);
      }
    },
    [onStrokeMessage],
  );

  // -- Pointer handlers -------------------------------------------------------

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Pending image: confirm placement
      if (pendingImageRef.current) {
        const pending = pendingImageRef.current;
        const rect = e.currentTarget.getBoundingClientRect();
        const wpX = (e.clientX - rect.left) / rect.width;
        const wpY = (e.clientY - rect.top) / rect.height + viewportOffsetYRef.current;
        const imageObj: ImageObject = {
          id: pending.id, src: pending.src,
          x: wpX - pending.width / 2, y: wpY - pending.height / 2,
          width: pending.width, height: pending.height,
        };
        imagesRef.current.push(imageObj);
        imageCacheRef.current.set(imageObj.id, pending.el);
        const staticCanvas = staticCanvasRefRef.current?.current;
        if (staticCanvas) redrawAll(strokesRef.current, imagesRef.current, imageCacheRef.current, staticCanvas, viewportOffsetYRef.current);
        onStrokeMessage?.({ type: 'image_add', image: imageObj });
        pendingImageRef.current = null;
        setHasPendingImage(false);
        return;
      }

      if (activePointerIdRef.current !== null && isDrawingRef.current) return;
      activePointerIdRef.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      const point = getCanvasPoint(e.clientX, e.clientY, e.pressure, rect, viewportOffsetYRef.current);
      isDrawingRef.current = true;
      const tool = styleRef.current.tool;

      // Select tool
      if (tool === 'select') {
        const phase = selectPhaseRef.current;
        if (phase === 'selected') {
          const bbox = combinedBBox(selectedIdsRef.current, strokesRef.current, imagesRef.current);
          if (bbox && pointInBBox(point, bbox)) {
            selectPhaseRef.current = 'moving';
            moveStartRef.current = point;
            moveDeltaRef.current = { dx: 0, dy: 0 };
            movingStrokesRef.current = strokesRef.current.filter(s => selectedIdsRef.current.has(s.id));
            movingImagesRef.current = imagesRef.current.filter(img => selectedIdsRef.current.has(img.id));
            strokesRef.current = strokesRef.current.filter(s => !selectedIdsRef.current.has(s.id));
            imagesRef.current = imagesRef.current.filter(img => !selectedIdsRef.current.has(img.id));
            const staticCanvas = staticCanvasRefRef.current?.current;
            if (staticCanvas) redrawAll(strokesRef.current, imagesRef.current, imageCacheRef.current, staticCanvas, viewportOffsetYRef.current);
            return;
          }
          clearSelectionInternal();
        }
        selectPhaseRef.current = 'selecting';
        selectStartRef.current = point;
        selectEndRef.current = point;
        return;
      }

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
    [onStrokeMessage, handleEraserMove, clearSelectionInternal],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = e.currentTarget;
      const rect = canvas.getBoundingClientRect();

      // Pending image follows pointer even without pressing
      if (pendingImageRef.current) {
        const wpX = (e.clientX - rect.left) / rect.width;
        const wpY = (e.clientY - rect.top) / rect.height + viewportOffsetYRef.current;
        pendingImageRef.current.x = wpX - pendingImageRef.current.width / 2;
        pendingImageRef.current.y = wpY - pendingImageRef.current.height / 2;
        return;
      }

      if (!isDrawingRef.current) return;
      if (e.pointerId !== activePointerIdRef.current) return;
      const tool = styleRef.current.tool;

      if (tool === 'select') {
        const point = getCanvasPoint(e.clientX, e.clientY, e.pressure, rect, viewportOffsetYRef.current);
        if (selectPhaseRef.current === 'selecting') {
          selectEndRef.current = point;
        } else if (selectPhaseRef.current === 'moving' && moveStartRef.current) {
          moveDeltaRef.current = {
            dx: point.x - moveStartRef.current.x,
            dy: point.y - moveStartRef.current.y,
          };
        }
        return;
      }

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
    [flushBatch, handleEraserMove],
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
    if (selectPhaseRef.current === 'selecting') {
      selectPhaseRef.current = 'idle';
      selectStartRef.current = null;
      selectEndRef.current = null;
    } else if (selectPhaseRef.current === 'moving') {
      strokesRef.current.push(...movingStrokesRef.current);
      imagesRef.current.push(...movingImagesRef.current);
      movingStrokesRef.current = [];
      movingImagesRef.current = [];
      selectPhaseRef.current = 'idle';
      selectedIdsRef.current.clear();
      moveStartRef.current = null;
      moveDeltaRef.current = { dx: 0, dy: 0 };
      const canvas = staticCanvasRefRef.current?.current;
      if (canvas) redrawAll(strokesRef.current, imagesRef.current, imageCacheRef.current, canvas, viewportOffsetYRef.current);
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

      // Select tool
      if (tool === 'select') {
        if (selectPhaseRef.current === 'selecting') {
          selectEndRef.current = point;
          const start = selectStartRef.current;
          if (start) {
            const selRect = normalizeRect(start.x, start.y, point.x, point.y);
            const ids = new Set<string>();
            for (const s of strokesRef.current) { if (bboxOverlap(selRect, getStrokeBBox(s))) ids.add(s.id); }
            for (const img of imagesRef.current) { if (bboxOverlap(selRect, getImageBBox(img))) ids.add(img.id); }
            if (ids.size > 0) {
              selectedIdsRef.current = ids;
              selectPhaseRef.current = 'selected';
            } else {
              selectPhaseRef.current = 'idle';
              selectStartRef.current = null;
              selectEndRef.current = null;
            }
          }
        } else if (selectPhaseRef.current === 'moving') {
          const dx = moveDeltaRef.current.dx;
          const dy = moveDeltaRef.current.dy;
          const ids = Array.from(selectedIdsRef.current);
          for (const s of movingStrokesRef.current) {
            s.points = s.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
          }
          for (const img of movingImagesRef.current) { img.x += dx; img.y += dy; }
          strokesRef.current.push(...movingStrokesRef.current);
          imagesRef.current.push(...movingImagesRef.current);
          movingStrokesRef.current = [];
          movingImagesRef.current = [];
          if (staticCanvas) redrawAll(strokesRef.current, imagesRef.current, imageCacheRef.current, staticCanvas, viewportOffsetYRef.current);
          onStrokeMessage?.({ type: 'objects_move', objectIds: ids, deltaX: dx, deltaY: dy });
          selectedIdsRef.current.clear();
          selectPhaseRef.current = 'idle';
          selectStartRef.current = null;
          selectEndRef.current = null;
          moveStartRef.current = null;
          moveDeltaRef.current = { dx: 0, dy: 0 };
        }
        return;
      }

      if (tool === 'eraser') { eraserDeletedRef.current.clear(); return; }

      if (tool === 'line' || tool === 'rect') {
        const startPoint = shapeStartRef.current;
        if (startPoint && staticCanvas) {
          const strokeId = nextStrokeId();
          const stroke: StrokeObject = { id: strokeId, tool, style: { ...styleRef.current }, points: [startPoint, point] };
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
        if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null; }
        flushBatch();
        const pts = currentPointsRef.current;
        if (staticCanvas && pts.length >= 2) {
          const stroke: StrokeObject = { id: currentStrokeIdRef.current, tool, style: { ...styleRef.current }, points: [...pts] };
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
    [flushBatch, onStrokeMessage, clearSelectionInternal],
  );

  // -- Overlay ----------------------------------------------------------------

  const renderOverlay = useCallback(
    (overlayCanvas: HTMLCanvasElement) => {
      const ctx = overlayCanvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

      // Pending image preview
      if (pendingImageRef.current) {
        const pi = pendingImageRef.current;
        const px = pi.x * overlayCanvas.width;
        const py = (pi.y - viewportOffsetYRef.current) * overlayCanvas.height;
        const pw = pi.width * overlayCanvas.width;
        const ph = pi.height * overlayCanvas.height;
        ctx.globalAlpha = 0.7;
        ctx.drawImage(pi.el, px, py, pw, ph);
        ctx.globalAlpha = 1.0;
        ctx.setLineDash([6, 3]);
        ctx.strokeStyle = '#7C4DFF';
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, pw, ph);
        ctx.setLineDash([]);
        return;
      }

      const tool = styleRef.current.tool;

      // Select tool overlays
      if (tool === 'select') {
        const phase = selectPhaseRef.current;
        if (phase === 'selecting' && selectStartRef.current && selectEndRef.current) {
          const s = selectStartRef.current, en = selectEndRef.current;
          const sx = s.x * overlayCanvas.width, sy = (s.y - viewportOffsetYRef.current) * overlayCanvas.height;
          const ex = en.x * overlayCanvas.width, ey = (en.y - viewportOffsetYRef.current) * overlayCanvas.height;
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = '#7C4DFF';
          ctx.lineWidth = 2;
          ctx.fillStyle = 'rgba(124, 77, 255, 0.08)';
          ctx.fillRect(sx, sy, ex - sx, ey - sy);
          ctx.strokeRect(sx, sy, ex - sx, ey - sy);
          ctx.setLineDash([]);
          return;
        }
        if (phase === 'selected') {
          const bbox = combinedBBox(selectedIdsRef.current, strokesRef.current, imagesRef.current);
          if (bbox) {
            const bx = bbox.minX * overlayCanvas.width;
            const by = (bbox.minY - viewportOffsetYRef.current) * overlayCanvas.height;
            const bw = (bbox.maxX - bbox.minX) * overlayCanvas.width;
            const bh = (bbox.maxY - bbox.minY) * overlayCanvas.height;
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = '#7C4DFF';
            ctx.lineWidth = 2;
            ctx.fillStyle = 'rgba(124, 77, 255, 0.06)';
            ctx.fillRect(bx, by, bw, bh);
            ctx.strokeRect(bx, by, bw, bh);
            ctx.setLineDash([]);
          }
          return;
        }
        if (phase === 'moving') {
          const dx = moveDeltaRef.current.dx, dy = moveDeltaRef.current.dy;
          for (const s of movingStrokesRef.current) {
            const moved: StrokeObject = { ...s, points: s.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })) };
            renderStroke(ctx, moved, overlayCanvas, viewportOffsetYRef.current);
          }
          for (const img of movingImagesRef.current) {
            const el = imageCacheRef.current.get(img.id);
            if (el) renderImage(ctx, { ...img, x: img.x + dx, y: img.y + dy }, el, overlayCanvas, viewportOffsetYRef.current);
          }
          const allIds = new Set([...movingStrokesRef.current.map(s => s.id), ...movingImagesRef.current.map(i => i.id)]);
          const origBBox = combinedBBox(allIds, movingStrokesRef.current, movingImagesRef.current);
          if (origBBox) {
            const bx = (origBBox.minX + dx) * overlayCanvas.width;
            const by = (origBBox.minY + dy - viewportOffsetYRef.current) * overlayCanvas.height;
            const bw = (origBBox.maxX - origBBox.minX) * overlayCanvas.width;
            const bh = (origBBox.maxY - origBBox.minY) * overlayCanvas.height;
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = '#7C4DFF';
            ctx.lineWidth = 2;
            ctx.strokeRect(bx, by, bw, bh);
            ctx.setLineDash([]);
          }
          return;
        }
        return;
      }

      if ((tool === 'line' || tool === 'rect') && shapeStartRef.current && shapeEndRef.current) {
        drawShape(ctx, styleRef.current, shapeStartRef.current, shapeEndRef.current, overlayCanvas, viewportOffsetYRef.current);
        return;
      }

      if (tool === 'eraser') return;

      const pts = currentPointsRef.current;
      if (pts.length < 2) return;
      if (tool === 'pixel_eraser') {
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
    [],
  );

  // -- Apply remote messages --------------------------------------------------

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
            // wait for stroke_end
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
          strokesRef.current.push({ id: remote.strokeId, tool: remote.style.tool, style: remote.style, points: [...remote.points] });
          remoteStrokeRef.current = null;
          break;
        }
        case 'stroke_delete': {
          const idx = strokesRef.current.findIndex((s) => s.id === msg.strokeId);
          if (idx !== -1) {
            strokesRef.current.splice(idx, 1);
            redrawAll(strokesRef.current, imagesRef.current, imageCacheRef.current, staticCanvas, viewportOffsetYRef.current);
          }
          break;
        }
        case 'image_add': {
          imagesRef.current.push(msg.image);
          const imgEl = new Image();
          imgEl.onload = () => {
            imageCacheRef.current.set(msg.image.id, imgEl);
            redrawAll(strokesRef.current, imagesRef.current, imageCacheRef.current, staticCanvas, viewportOffsetYRef.current);
          };
          imgEl.src = msg.image.src;
          break;
        }
        case 'image_delete': {
          const idx = imagesRef.current.findIndex((i) => i.id === msg.imageId);
          if (idx !== -1) {
            imagesRef.current.splice(idx, 1);
            imageCacheRef.current.delete(msg.imageId);
            redrawAll(strokesRef.current, imagesRef.current, imageCacheRef.current, staticCanvas, viewportOffsetYRef.current);
          }
          break;
        }
        case 'objects_move': {
          const idSet = new Set(msg.objectIds);
          for (const s of strokesRef.current) {
            if (idSet.has(s.id)) s.points = s.points.map(p => ({ ...p, x: p.x + msg.deltaX, y: p.y + msg.deltaY }));
          }
          for (const img of imagesRef.current) {
            if (idSet.has(img.id)) { img.x += msg.deltaX; img.y += msg.deltaY; }
          }
          redrawAll(strokesRef.current, imagesRef.current, imageCacheRef.current, staticCanvas, viewportOffsetYRef.current);
          break;
        }
        case 'clear':
          ctx.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
          strokesRef.current = [];
          imagesRef.current = [];
          imageCacheRef.current.clear();
          break;
        case 'snapshot': {
          const img = new Image();
          img.onload = () => {
            const scale = staticCanvas.width / img.naturalWidth;
            ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, staticCanvas.width, img.naturalHeight * scale);
          };
          img.src = msg.dataUrl;
          strokesRef.current = [];
          imagesRef.current = [];
          imageCacheRef.current.clear();
          break;
        }
        case 'sync_strokes': {
          strokesRef.current = msg.strokes;
          imagesRef.current = msg.images ?? [];
          const toLoad = imagesRef.current.filter(i => !imageCacheRef.current.has(i.id));
          if (toLoad.length === 0) {
            redrawAll(strokesRef.current, imagesRef.current, imageCacheRef.current, staticCanvas, viewportOffsetYRef.current);
          } else {
            let loaded = 0;
            for (const imgObj of toLoad) {
              const imgEl = new Image();
              imgEl.onload = () => {
                imageCacheRef.current.set(imgObj.id, imgEl);
                if (++loaded === toLoad.length) redrawAll(strokesRef.current, imagesRef.current, imageCacheRef.current, staticCanvas, viewportOffsetYRef.current);
              };
              imgEl.src = imgObj.src;
            }
          }
          break;
        }
        default:
          break;
      }
    },
    [],
  );

  // -- Canvas operations ------------------------------------------------------

  const clearCanvas = useCallback(
    (staticCanvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement) => {
      const sCtx = staticCanvas.getContext('2d');
      const oCtx = overlayCanvas.getContext('2d');
      sCtx?.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
      oCtx?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      strokesRef.current = [];
      imagesRef.current = [];
      imageCacheRef.current.clear();
      clearSelectionInternal();
    },
    [clearSelectionInternal],
  );

  const scrollBy = useCallback((deltaY: number) => {
    setViewportOffsetY((prev) => {
      const next = Math.max(0, prev + deltaY);
      viewportOffsetYRef.current = next;
      return next;
    });
  }, []);

  const redrawStatic = useCallback((canvas: HTMLCanvasElement) => {
    redrawAll(strokesRef.current, imagesRef.current, imageCacheRef.current, canvas, viewportOffsetYRef.current);
  }, []);

  const getFullSnapshot = useCallback(
    (screenCanvas: HTMLCanvasElement): string => {
      const strokes = strokesRef.current;
      const images = imagesRef.current;
      const screenW = screenCanvas.width;
      const screenH = screenCanvas.height;
      const tmp = document.createElement('canvas');
      const ctx = tmp.getContext('2d')!;

      if (strokes.length === 0 && images.length === 0) {
        tmp.width = screenW;
        tmp.height = screenH;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, screenW, screenH);
        ctx.drawImage(screenCanvas, 0, 0);
        return tmp.toDataURL('image/png');
      }

      let maxWorldY = 1;
      for (const s of strokes) { for (const p of s.points) { if (p.y > maxWorldY) maxWorldY = p.y; } }
      for (const img of images) { const b = img.y + img.height; if (b > maxWorldY) maxWorldY = b; }
      maxWorldY += 0.05;

      tmp.width = screenW;
      tmp.height = Math.ceil(maxWorldY * screenH);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, tmp.width, tmp.height);

      const vCanvas = { width: screenW, height: screenH } as unknown as HTMLCanvasElement;
      for (const img of images) {
        const el = imageCacheRef.current.get(img.id);
        if (el) renderImage(ctx, img, el, vCanvas, 0);
      }
      for (const s of strokes) { renderStroke(ctx, s, vCanvas, 0); }

      return tmp.toDataURL('image/png');
    },
    [],
  );

  const getStrokes = useCallback((): StrokeObject[] => [...strokesRef.current], []);
  const getImages = useCallback((): ImageObject[] => [...imagesRef.current], []);

  const handlePasteImage = useCallback((dataUrl: string) => {
    const el = new Image();
    el.onload = () => {
      const canvas = staticCanvasRefRef.current?.current;
      const rect = canvas?.getBoundingClientRect();
      const canvasW = rect?.width ?? 800;
      const canvasH = rect?.height ?? 600;
      // 100% natural size: map image pixels to normalized canvas coordinates
      const normW = el.naturalWidth / canvasW;
      const normH = el.naturalHeight / canvasH;
      const cx = 0.5 - normW / 2;
      const cy = viewportOffsetYRef.current + 0.5 - normH / 2;
      pendingImageRef.current = { id: nextImageId(), src: dataUrl, width: normW, height: normH, x: cx, y: cy, el };
      setHasPendingImage(true);
    };
    el.src = dataUrl;
  }, []);

  const cancelPendingAction = useCallback(() => {
    if (pendingImageRef.current) {
      pendingImageRef.current = null;
      setHasPendingImage(false);
    }
    if (selectPhaseRef.current !== 'idle') {
      clearSelectionInternal();
      const canvas = staticCanvasRefRef.current?.current;
      if (canvas) redrawAll(strokesRef.current, imagesRef.current, imageCacheRef.current, canvas, viewportOffsetYRef.current);
    }
  }, [clearSelectionInternal]);

  return {
    style,
    viewportOffsetY,
    hasPendingImage,
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
    getImages,
    handlePasteImage,
    cancelPendingAction,
  };
}
