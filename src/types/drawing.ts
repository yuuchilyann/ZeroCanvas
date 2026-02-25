export type Tool = 'pen' | 'eraser' | 'pixel_eraser' | 'line' | 'rect' | 'select';

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

/** An image pasted onto the canvas */
export interface ImageObject {
  id: string;
  src: string;    // Data URL
  x: number;      // world-space X (normalized, 0 = left edge)
  y: number;      // world-space Y (normalized, 0 = top)
  width: number;  // normalized width relative to canvas width
  height: number; // normalized height relative to canvas height
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
  | { type: 'sync_strokes'; strokes: StrokeObject[]; images?: ImageObject[] }
  | { type: 'image_add'; image: ImageObject }
  | { type: 'image_delete'; imageId: string }
  | { type: 'objects_move'; objectIds: string[]; deltaX: number; deltaY: number };
