import { Filter, Texture, BufferResource, BaseTexture, FORMATS, TYPES } from 'pixi.js';
// Assuming Vite raw loader for fragment shaders
import multiLensFrag from './multi_lens.frag?raw'; 

export class HazardLensFilter extends Filter {
    private hazardTexture: Texture;
    private hazardData: Float32Array;

    constructor(gridWidth: number, gridHeight: number, sharedBuffer: SharedArrayBuffer) {
        const totalNodes = gridWidth * gridHeight;
        const offset = totalNodes * Uint8Array.BYTES_PER_ELEMENT;
        
        // Map directly to the exact memory block written by the GameRunner
        this.hazardData = new Float32Array(sharedBuffer, offset, totalNodes * 4);

        const resource = new BufferResource(this.hazardData, {
            width: gridWidth,
            height: gridHeight,
        });

        const baseTexture = new BaseTexture(resource, {
            format: FORMATS.RGBA, // 4 Channels mapped to physical, cyber, economic, political
            type: TYPES.FLOAT,
        });

        this.hazardTexture = new Texture(baseTexture);

        super(undefined, multiLensFrag, {
            uMultiHazardMap: this.hazardTexture,
            uTime: 0.0,
            uActiveLens: 0 // Default to Physical Lens
        });
    }

    public setActiveLens(lensId: number): void {
        this.uniforms.uActiveLens = lensId;
    }

    public update(delta: number): void {
        this.uniforms.uTime += delta * 0.01;
        // Pushes the updated SharedArrayBuffer frame to the GPU
        this.hazardTexture.baseTexture.update();
    }
}