// WGSL shaders for Framed.
//
// The drawing model mirrors the original Cinder/OpenGL app:
//  - The "paper" of each animation frame is an offscreen texture (the FBO).
//  - Brush dots are soft circular point-sprites drawn with premultiplied-alpha
//    blending so overlapping dots build up a smooth stroke.
//  - Shapes (circle / rectangle) are solid geometry drawn into the same texture.
//  - Finally the frame textures are blitted to the swap-chain (screen) with a
//    2D transform (zoom / pan) and an optional alpha tint (for onion skinning).

// Brush: instanced soft dots, rendered into a frame texture (pixel space).
// Constant-pixel feather at the edge (same AA width regardless of brush size).
export const BRUSH_WGSL = /* wgsl */ `
struct U { res: vec2f };
@group(0) @binding(0) var<uniform> u: U;

const FEATHER_PX: f32 = 18.0;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) diameterPx: f32,
};

@vertex
fn vs(
  @builtin(vertex_index) vi: u32,
  @location(0) inst_pos: vec2f,
  @location(1) inst_size: f32,
  @location(2) inst_color: vec4f,
) -> VSOut {
  var corners = array<vec2f, 6>(
    vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(-0.5, 0.5),
    vec2f(-0.5, 0.5),  vec2f(0.5, -0.5), vec2f(0.5, 0.5),
  );
  let c = corners[vi];
  let diameter = max(inst_size, 2.0);
  let px = inst_pos + c * diameter;
  let clip = vec2f(px.x / u.res.x * 2.0 - 1.0, 1.0 - px.y / u.res.y * 2.0);
  var o: VSOut;
  o.pos = vec4f(clip, 0.0, 1.0);
  o.uv = c + vec2f(0.5, 0.5);
  o.color = inst_color;
  o.diameterPx = diameter;
  return o;
}

@fragment
fn fs(
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) diameterPx: f32,
) -> @location(0) vec4f {
  let distPx = length(uv - vec2f(0.5)) * diameterPx;
  let radiusPx = diameterPx * 0.5;
  if (distPx > radiusPx) {
    discard;
  }
  // Never feather past the radius — small brushes would otherwise be semi-transparent.
  let feather = min(FEATHER_PX, radiusPx);
  let innerPx = radiusPx - feather;
  // Solid core: skip soft falloff for the interior (large brushes spend most pixels here).
  var a = color.a;
  if (distPx > innerPx) {
    a = (1.0 - smoothstep(innerPx, radiusPx, distPx)) * color.a;
  }
  return vec4f(color.rgb * a, a);
}
`;

// Shape: solid triangles drawn into a frame texture (pixel space).
export const SHAPE_WGSL = /* wgsl */ `
struct U {
  res: vec2f,
  _pad: vec2f,
  color: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;

@vertex
fn vs(@location(0) p: vec2f) -> @builtin(position) vec4f {
  let clip = vec2f(p.x / u.res.x * 2.0 - 1.0, 1.0 - p.y / u.res.y * 2.0);
  return vec4f(clip, 0.0, 1.0);
}

@fragment
fn fs() -> @location(0) vec4f {
  // premultiplied
  return vec4f(u.color.rgb * u.color.a, u.color.a);
}
`;

// Blit: copy a frame texture to the screen with a 2D transform + tint.
// transform maps a unit quad [0,1]^2 to clip space:
//   clip = transform.zw + p * transform.xy
export const BLIT_WGSL = /* wgsl */ `
struct U {
  transform: vec4f,
  tint: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var q = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  );
  let p = q[vi];
  let clip = vec2f(u.transform.z + p.x * u.transform.x,
                   u.transform.w + p.y * u.transform.y);
  var o: VSOut;
  o.pos = vec4f(clip, 0.0, 1.0);
  o.uv = p;
  return o;
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  // frame content is premultiplied; tint = (t,t,t,t) keeps it premultiplied
  return textureSample(tex, samp, uv) * u.tint;
}
`;

// Overlay: clip-space colored triangles drawn straight onto the screen,
// used for the in-progress shape preview and the active-frame highlight.
export const OVERLAY_WGSL = /* wgsl */ `
struct U { color: vec4f };
@group(0) @binding(0) var<uniform> u: U;

@vertex
fn vs(@location(0) p: vec2f) -> @builtin(position) vec4f {
  return vec4f(p, 0.0, 1.0);
}

@fragment
fn fs() -> @location(0) vec4f {
  return u.color;
}
`;
