export type Tool = 'pen' | 'eraser' | 'line' | 'rect';

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

// Messages sent over PeerJS DataChannel
export type DrawMessage =
  | { type: 'stroke_start'; style: DrawStyle; point: Point }
  | { type: 'stroke_move'; points: Point[] }
  | { type: 'stroke_end' }
  | { type: 'clear' }
  | { type: 'snapshot_request' }
  | { type: 'snapshot'; dataUrl: string };
