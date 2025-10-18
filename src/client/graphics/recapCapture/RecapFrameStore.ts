export interface RecapFrame {
  tick: number;
  capturedAt: number;
  blob: Blob;
  width: number;
  height: number;
  objectUrl: string;
  imageBitmap?: ImageBitmap;
}

export interface SerializableRecapFrame {
  tick: number;
  capturedAt: number;
  mimeType: string;
  dataUrl: string;
}

type Subscriber = (frames: readonly RecapFrame[]) => void;

export class RecapFrameStore {
  private frames: RecapFrame[] = [];
  private subscribers: Set<Subscriber> = new Set();
  private loopPauseMs = 0;
  private totalBlobBytes = 0;

  constructor(private readonly maxFrames: number) {}

  addFrame(frame: Omit<RecapFrame, "objectUrl">) {
    const objectUrl = URL.createObjectURL(frame.blob);
    const nextFrame: RecapFrame = { ...frame, objectUrl };
    this.frames.push(nextFrame);
    this.totalBlobBytes += frame.blob.size;
    this.compactIfNeeded();
    this.notify();
  }

  getFrames(): readonly RecapFrame[] {
    return this.frames;
  }

  private compactIfNeeded() {
    if (!Number.isFinite(this.maxFrames) || this.maxFrames <= 0) {
      return;
    }
    while (this.frames.length > this.maxFrames) {
      const next: RecapFrame[] = [];
      const removed: RecapFrame[] = [];
      for (let index = 0; index < this.frames.length; index += 1) {
        if (index % 2 === 0) {
          next.push(this.frames[index]);
        } else {
          removed.push(this.frames[index]);
        }
      }
      if (next.length === this.frames.length) {
        break;
      }
      removed.forEach((frame) => {
        this.totalBlobBytes -= frame.blob.size;
        URL.revokeObjectURL(frame.objectUrl);
      });
      this.frames = next;
    }
  }

  getFrameCount(): number {
    return this.frames.length;
  }

  getLoopPauseMs(): number {
    return this.loopPauseMs;
  }

  setLoopPauseMs(durationMs: number) {
    this.loopPauseMs = Math.max(0, Math.round(durationMs));
    this.notify();
  }

  clear() {
    for (const frame of this.frames) {
      URL.revokeObjectURL(frame.objectUrl);
    }
    this.frames = [];
    this.loopPauseMs = 0;
    this.totalBlobBytes = 0;
    this.notify();
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.frames);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private notify() {
    for (const subscriber of this.subscribers) {
      subscriber(this.frames);
    }
  }

  async serializeFrames(mimeType: string): Promise<SerializableRecapFrame[]> {
    const serialized: SerializableRecapFrame[] = [];
    for (const frame of this.frames) {
      const dataUrl = await this.blobToDataUrl(frame.blob);
      serialized.push({
        tick: frame.tick,
        capturedAt: frame.capturedAt,
        mimeType,
        dataUrl,
      });
    }
    return serialized;
  }

  approximateDurationMs(): number {
    if (this.frames.length < 2) {
      return 0;
    }

    const first = this.frames[0];
    const last = this.frames[this.frames.length - 1];
    return last.capturedAt - first.capturedAt;
  }

  getApproximateBlobBytes(): number {
    return this.totalBlobBytes;
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }
}
