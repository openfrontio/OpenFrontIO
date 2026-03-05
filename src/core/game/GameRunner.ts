import { TerrainSearchMap } from './TerrainSearchMap';

export interface WorldHazardEvent {
    event_hash: string;
    center_x: number;
    center_y: number;
    severity: number;
    radius: number;
    tick_applied: number;
    category: string;
}

export class GameRunner {
    private currentTick: number = 0;
    private eventBuffer: Map<number, { events: WorldHazardEvent[] }> = new Map();
    private terrainMap: TerrainSearchMap;

    constructor(terrainMap: TerrainSearchMap) {
        this.terrainMap = terrainMap;
    }

    public queueWorldEvents(batch: { game_tick: number; events: WorldHazardEvent[] }): void {
        this.eventBuffer.set(batch.game_tick, batch);
    }

    public update(): void {
        const tickEvents = this.eventBuffer.get(this.currentTick);
        
        if (tickEvents && tickEvents.events) {
            for (const event of tickEvents.events) {
                // Instantly mutates the SharedArrayBuffer. 
                this.terrainMap.applyMultiHazardImpulse(event);
            }
            this.eventBuffer.delete(this.currentTick);
        }

        // Decay specific hazards over time
        if (this.currentTick % 60 === 0) { 
            this.decayHazards();
        }

        this.currentTick++;
    }

    private decayHazards(): void {
        // We do not decay economic/cyber out of hand, but physical fires/storms naturally subside
        const floatArray = (this.terrainMap as any).multiHazardVectors as Float32Array;
        for (let i = 0; i < floatArray.length; i += 4) {
            // Channel 0: Physical (decay fast)
            if (floatArray[i] > 0.0) {
                floatArray[i] = Math.max(0.0, floatArray[i] - 0.05);
            }
            // Channel 3: Political (decay slow)
            if (floatArray[i+3] > 0.0) {
                floatArray[i+3] = Math.max(0.0, floatArray[i+3] - 0.005);
            }
        }
    }
}