struct Uniforms {
  mapResolution_viewScale_time: vec4f, // x=mapW, y=mapH, z=viewScale, w=timeSec
  viewOffset_alt_highlight: vec4f,     // x=offX, y=offY, z=alternativeView, w=highlightOwnerId
  viewSize_pad: vec4f,                // x=viewW, y=viewH, z/w unused
};

struct DefenseParams {
  range: u32,
  postCount: u32,
  epoch: u32,
  _pad: u32,
};
