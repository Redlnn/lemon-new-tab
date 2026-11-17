import { beachGullShader } from '../dynamic/gullShader'

// Small, scissored detail passes all composite the same scene, so overlapping
// subjects keep their correct order instead of erasing each other.
export const oceanShader = `
#ifdef OCEAN
uniform float uOceanTime;
uniform sampler2D uOceanWake;
uniform vec2 uOceanWakeSize;
mat2 oceanRot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
#ifdef OCEAN_DETAIL
uniform vec4 uOceanActors[22]; // x, y, heading, kind
uniform vec2 uOceanExtras[22]; // boom angle or ripple age
uniform int uOceanCount;
uniform sampler2D uOceanWhale;
float oceanEllipse(vec2 p, vec2 r) { return (length(p / r) - 1.) * min(r.x, r.y); }
float oceanBox(vec2 p, vec2 halfSize, float r) {
  vec2 d = abs(p) - halfSize + r;
  return length(max(d, 0.)) + min(max(d.x, d.y), 0.) - r;
}
float oceanTriangle(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 ab = b-a, bc = c-b, ca = a-c;
  float area = ab.x * (c.y-a.y) - ab.y * (c.x-a.x);
  float dist = min(segD(p,a,b), min(segD(p,b,c), segD(p,c,a)));
  if (abs(area) < .01) return dist;
  float s = sign(area);
  bool inside = s*(ab.x*(p.y-a.y)-ab.y*(p.x-a.x)) >= 0. &&
    s*(bc.x*(p.y-b.y)-bc.y*(p.x-b.x)) >= 0. &&
    s*(ca.x*(p.y-c.y)-ca.y*(p.x-c.x)) >= 0.;
  return inside ? -dist : dist;
}
float oceanHull(vec2 q, float length, float width) {
  float front = clamp((q.x + length * .1) / (length * 1.1), 0., 1.);
  float halfWidth = width * (1. - pow(front, 1.45));
  return max(abs(q.y) - halfWidth, max(q.x - length, -q.x - length * .8));
}
${beachGullShader}
vec3 oceanOne(vec3 col, vec2 p, vec4 actor, vec2 extra) {
  vec2 d = p - actor.xy;
  float kind = actor.w;
  if (kind < 4. && dot(d,d) > (kind > 1.5 && kind < 2.5 ? 48400. : 12000.)) return col;
  vec2 q = oceanRot(-actor.z) * d;
  if (kind < 1.5) {
    float len = kind < .5 ? 25. : 30.;
    float width = kind < .5 ? 7. : 10.;
    float shadow = oceanHull(q - oceanRot(-actor.z) * vec2(4., 8.), len, width);
    col = mix(col, col * vec3(.55,.65,.8), ss(3.,-2.,shadow) * .32);
    float hull = oceanHull(q, len, width);
    col = mix(col, vec3(.52,.62,.69), ss(1.,-.5,hull));
    col = mix(col, vec3(.97,.97,.93), ss(-.2,-1.6,hull));
    // Dark waterline, clean pale deck and small cockpit details.
    col = mix(col, vec3(.69,.77,.79), ss(-1.8,-2.4,hull) * (1. - ss(-2.6,-3.4,hull)));
    if (kind < .5) {
      float cockpit = oceanBox(q - vec2(-10.,0.), vec2(6.,3.), 1.5);
      col = mix(col, vec3(.48,.59,.62), ss(.5,-.5,cockpit));
      col = mix(col, vec3(.90,.91,.85), ss(-.5,-1.2,cockpit));
      // The boom responds gradually to wind; the upright mast projects towards the light.
      vec2 mast = vec2(1.,0.);
      vec2 mastTip = mast + oceanRot(-actor.z) * vec2(-4.,-23.);
      vec2 boom = mast + oceanRot(extra.x) * vec2(-18.,0.);
      float sail = oceanTriangle(q,mastTip,mast,boom);
      col = mix(col, vec3(.67,.73,.73), ss(.9,-.5,sail));
      col = mix(col, vec3(1.,.99,.94), ss(-.2,-1.1,sail));
      float fore = oceanTriangle(q,mastTip,vec2(22.,0.),mast);
      col = mix(col, vec3(.76,.82,.82), ss(.6,-.4,fore));
      col = mix(col, vec3(.99,.99,.96), ss(-.3,-1.1,fore));
      float spar = min(segD(q,mast,mastTip),segD(q,mast,boom));
      col = mix(col, vec3(.47,.54,.57), 1. - ss(.3,1.,spar));
    } else {
      float cockpit = oceanBox(q - vec2(-14.,0.), vec2(7.,6.), 2.);
      col = mix(col, vec3(.38,.55,.61), ss(.6,-.5,cockpit));
      col = mix(col, vec3(.89,.90,.84), ss(-1.,-2.,cockpit));
      float cabin = oceanBox(q - vec2(1.,0.), vec2(9.,6.), 2.);
      col = mix(col, vec3(.45,.65,.70), ss(.6,-.5,cabin));
      col = mix(col, vec3(.97,.97,.92), ss(-1.2,-2.2,cabin));
      float window = oceanBox(q - vec2(6.,0.), vec2(2.,4.5), 1.);
      col = mix(col, vec3(.25,.48,.58), ss(.5,-.5,window));
      float hatch = oceanBox(q - vec2(16.,0.), vec2(2.,2.), .8);
      col = mix(col, vec3(.75,.83,.82), ss(.4,-.5,hatch));
    }
  } else if (kind < 2.5) {
    // The tail trails the body while turning. Up/down strokes are shown as
    // foreshortening from above, not as a side-to-side sweep.
    float tailWeight = ss(20., -90., q.x);
    q.y -= tailWeight * extra.x;
    float tailPitch = .76 + .24 * cos(uOceanTime * 1.3 + actor.x * .01);
    float pitchWeight = ss(-60., -110., q.x);
    q.x = mix(q.x, -60. + (q.x + 60.) / tailPitch, pitchWeight);
    float inside = step(-150., q.x) * step(q.x, 150.) * step(-50., q.y) * step(q.y, 50.);
    vec4 whale = texture(uOceanWhale, vec2(
      ((.5 - q.x / 300.) * 1086. - 60.) / 973.,
      ((.5 + q.y / 100.) * 362. - 2.) / 357.
    ));
    col = mix(col, vec3(.035,.14,.34), whale.a * inside * .32);
    col += whale.rgb * whale.a * inside * .045;
  } else if (kind < 3.5) {
    vec2 sq = oceanRot(-actor.z) * (d - vec2(34.,55.));
    vec3 sh = gullSD(sq,.8);
    col = mix(col,col*mix(vec3(.7,.74,.84),vec3(.38,.48,.65),uNight),ss(1.8,-1.8,min(sh.x,sh.y))*.28);
    vec3 bird = gullSD(q,.68+.32*cos(uOceanTime*4.));
    col = mix(col,mix(mix(vec3(.80,.84,.88),vec3(.20,.22,.26),ss(.72,.8,bird.z)),mix(vec3(.35,.43,.56),vec3(.12,.17,.27),ss(.72,.8,bird.z)),uNight),ss(.6,-.6,bird.y));
    col = mix(col,mix(vec3(.99,.99,.98),vec3(.58,.67,.80),uNight),ss(.6,-.6,bird.x));
  } else {
    float radius = extra.x * 40., dist = length(q);
    float ripple = (1.-ss(.8,2.,abs(dist-radius)))*exp(-extra.x*1.4);
    ripple = max(ripple,(1.-ss(.6,1.6,abs(dist-radius*.6)))*exp(-extra.x*1.8)*.6);
    col = mix(col,vec3(.92,.98,1.),ripple*.6);
  }
  return col;
}
vec3 oceanDetail(vec3 col, vec2 p) {
  for (int i = 0; i < 22; i++) {
    if (i >= uOceanCount) break;
    col = oceanOne(col,p,uOceanActors[i],uOceanExtras[i]);
  }
  return col;
}
#endif
#endif
`
