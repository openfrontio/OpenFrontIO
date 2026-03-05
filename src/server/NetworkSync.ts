import { WebSocket } from 'ws';
import * as zlib from 'zlib';

export class NetworkSync {
    /**
     * Dumps the current global WGS84 hazard grid to a late-connecting client.
     */
    public static sendMapStateSnapshot(ws: WebSocket, memoryBuffer: SharedArrayBuffer): void {
        const rawMemoryView = new Uint8Array(memoryBuffer);
        
        // Compress the memory block (16MB down to ~500kb for mostly empty grids)
        zlib.deflate(rawMemoryView, (err, compressedBuffer) => {
            if (err) {
                console.error("Failed to deflate map state", err);
                return;
            }
            
            // 0x01 Header = MAP_STATE_SNAPSHOT
            const packetId = new Uint8Array([0x01]); 
            const payload = Buffer.concat([packetId, compressedBuffer]);
            
            ws.send(payload, { binary: true });
        });
    }
}