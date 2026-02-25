export type Tool = 'pen' | 'eraser' | 'pixel_eraser' | 'line' | 'rect';

export interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export interface DrawStyle {
  color: string;
  width: number;
  tool: Tool;
}

/** A committed stroke stored for object-model erasing */
export interface StrokeObject {
  id: string;
  tool: Tool;
  style: DrawStyle;
  points: Point[];
}

/** Viewport state for infinite canvas scrolling */
export interface Viewport {
  offsetY: number;  // vertical scroll offset in world units (0 = top)
}

// Messages sent over PeerJS DataChannel
export type DrawMessage =
  | { type: 'stroke_start'; style: DrawStyle; point: Point; strokeId?: string }
  | { type: 'stroke_move'; points: Point[] }
  | { type: 'stroke_end' }
  | { type: 'stroke_delete'; strokeId: string }
  | { type: 'clear' }
  | { type: 'snapshot_request' }
  | { type: 'snapshot'; dataUrl: string }
  | { type: 'sync_strokes'; strokes: StrokeObject[] };
