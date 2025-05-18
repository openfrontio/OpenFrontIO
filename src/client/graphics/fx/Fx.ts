// export function setPixel(imageData: ImageData, x: number, y: number, color: {r, g, b, a}) {
//     const index = y * imageData.width + x;
//     const offset = index * 4;
//     if (x < 0 || x >= imageData.width || y < 0 || y >= imageData.height) return;
//     imageData.data[index] = color.r;
//     imageData.data[index + 1] = color.g;
//     imageData.data[index + 2] = color.b;
//     imageData.data[index + 3] = color.a;
// };

export interface Fx {
  tick(duration: number, ctx: CanvasRenderingContext2D): boolean;
}

export interface PixelFx {
  tick(duration: number, imageData: ImageData): boolean;
}

export enum FxType {
  Nuke = "Nuke",
}
