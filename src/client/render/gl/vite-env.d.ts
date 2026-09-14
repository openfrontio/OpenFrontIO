declare module "*.glsl?raw" {
  const src: string;
  export default src;
}
declare module "*.png?url" {
  const url: string;
  export default url;
}
