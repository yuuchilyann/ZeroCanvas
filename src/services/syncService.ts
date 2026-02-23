import type { DrawMessage } from '../types/drawing';

type SendFn = (msg: DrawMessage, targetPeerId?: string) => void;
type BroadcastFn = (msg: DrawMessage) => void;

export class SyncService {
  private send: SendFn;
  private broadcast: BroadcastFn;
  // Offline queue: accumulated when disconnected
  private offlineQueue: DrawMessage[] = [];
  private connected = false;

  constructor(send: SendFn, broadcast: BroadcastFn) {
    this.send = send;
    this.broadcast = broadcast;
  }

  setConnected(connected: boolean) {
    const wasDisconnected = !this.connected;
    this.connected = connected;
    if (connected && wasDisconnected) {
      this.flushOfflineQueue();
    }
  }

  /** Client → Host: send a drawing event */
  sendDraw(msg: DrawMessage) {
    if (this.connected) {
      this.broadcast(msg);
    } else {
      this.offlineQueue.push(msg);
    }
  }

  /** Host → requesting Client: send full canvas snapshot */
  sendSnapshot(dataUrl: string, targetPeerId: string) {
    const msg: DrawMessage = { type: 'snapshot', dataUrl };
    this.send(msg, targetPeerId);
  }

  /** Host handles an incoming snapshot_request from a newly connected client */
  handleSnapshotRequest(
    getDataUrl: () => string,
    fromPeerId: string
  ) {
    const dataUrl = getDataUrl();
    if (dataUrl) this.sendSnapshot(dataUrl, fromPeerId);
  }

  /** Deserialize and validate an incoming message */
  static parse(raw: unknown): DrawMessage | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const msg = raw as DrawMessage;
    if (!msg.type) return null;
    return msg;
  }

  private flushOfflineQueue() {
    const queue = this.offlineQueue.splice(0);
    queue.forEach((msg) => this.broadcast(msg));
  }
}
