import pako from 'pako';

export class ClientSocketHandler {
    private localSharedBuffer: SharedArrayBuffer;

    constructor(buffer: SharedArrayBuffer) {
        this.localSharedBuffer = buffer;
    }

    public handleMessage(event: MessageEvent): void {
        if (!(event.data instanceof ArrayBuffer)) return;

        const rawData = new Uint8Array(event.data);
        const packetId = rawData[0];

        // Hydrate late-joiner map state
        if (packetId === 0x01) {
            const compressedPayload = rawData.slice(1);
            const inflatedMemory = pako.inflate(compressedPayload);

            // Directly overwrite the memory that PIXI.js and Web Workers are actively reading
            const localMemoryView = new Uint8Array(this.localSharedBuffer);
            localMemoryView.set(inflatedMemory);
            
            console.log("[RealFront] Global Hazard State Hydrated.");
        }
    }
}