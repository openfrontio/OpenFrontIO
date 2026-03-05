import { WorldHazardEvent } from './IngestionClient';

export class TerrainSearchMap {
    public readonly width: number;
    public readonly height: number;
    public readonly memoryBuffer: SharedArrayBuffer;
    
    // Base static cost (0-254, 255 = impassable like deep water)
    private baseCosts: Uint8Array;
    
    // Expanded: 4 floats per tile [Physical, Cyber, Economic, Political]
    private multiHazardVectors: Float32Array; 

    constructor(width: number, height: number, existingBuffer?: SharedArrayBuffer) {
        this.width = width;
        this.height = height;
        
        const totalNodes = width * height;
        const baseCostByteLength = totalNodes * Uint8Array.BYTES_PER_ELEMENT;
        
        // 4 channels * 4 bytes (Float32) per node
        const vectorByteLength = totalNodes * 4 * Float32Array.BYTES_PER_ELEMENT;
        
        this.memoryBuffer = existingBuffer || new SharedArrayBuffer(baseCostByteLength + vectorByteLength);
        this.baseCosts = new Uint8Array(this.memoryBuffer, 0, totalNodes);
        this.multiHazardVectors = new Float32Array(this.memoryBuffer, baseCostByteLength, totalNodes * 4);
    }

    public applyMultiHazardImpulse(event: WorldHazardEvent): void {
        const rad = Math.ceil(event.radius);
        
        // Determine memory channel based on event category
        let channelOffset = 0; // Default: Physical (Earthquakes, War)
        if (event.category === 'HAZARD_CYBER_ATTACK') channelOffset = 1;
        if (event.category === 'HAZARD_ECONOMIC_SANCTION') channelOffset = 2;
        if (event.category === 'HAZARD_CIVIL_UNREST') channelOffset = 3;

        for (let dy = -rad; dy <= rad; dy++) {
            for (let dx = -rad; dx <= rad; dx++) {
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance <= event.radius) {
                    const nx = event.center_x + dx;
                    const ny = event.center_y + dy;
                    
                    if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
                        const index = (ny * this.width + nx) * 4; 
                        const decay = 1.0 - (distance / event.radius);
                        
                        this.multiHazardVectors[index + channelOffset] = Math.min(1.0, this.multiHazardVectors[index + channelOffset] + (event.severity * decay));
                    }
                }
            }
        }
    }

    public getTraversalCost(x: number, y: number): number {
        const index = y * this.width + x;
        const base = this.baseCosts[index];
        
        if (base === 255) return Infinity;

        // Physical and Political hazards impact pathing speed
        const vectorIndex = index * 4;
        const physicalHazard = this.multiHazardVectors[vectorIndex];
        const politicalHazard = this.multiHazardVectors[vectorIndex + 3];
        
        let pathCost = base;
        
        if (physicalHazard > 0.0) {
            pathCost += (base * physicalHazard * 20.0);
        }
        
        if (politicalHazard > 0.0) {
            pathCost += (base * politicalHazard * 5.0);
        }

        return pathCost;
    }

    public getHazardVector(x: number, y: number): Float32Array {
        const index = (y * this.width + x) * 4;
        return this.multiHazardVectors.subarray(index, index + 4);
    }

    public serializeForWorker() {
        return {
            width: this.width,
            height: this.height,
            buffer: this.memoryBuffer
        };
    }
}