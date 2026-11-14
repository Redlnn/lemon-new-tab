export const beachVertexShader = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

export const beachFragmentShader = `#version 300 es
precision highp float;
uniform sampler2D uNoise, uFA, uFB;
uniform vec2 uRes, uGrid;
uniform float uScale, uSeed, uStep, uMix, uTime, uSpeed, uRunup, uShallow, uShoal, uGrain, uDebug, uWave, uSigma, uSpacing, uWaves;
uniform float uKayN;
uniform vec4 uKay[4];          // x, y, 朝向, 划桨相位
uniform vec4 uRip[6];
uniform float uBirdN;
uniform vec4 uBird[8];         // x, y, 朝向, 翅膀展开程度
out vec4 o;

// ---- 调色板（sRGB）----
// 海：近岸 → 远处
const vec3 SEA0 = vec3(0.74, 0.93, 0.87), SEA1 = vec3(0.47, 0.87, 0.84), SEA2 = vec3(0.17, 0.76, 0.81);
const vec3 SEA3 = vec3(0.03, 0.66, 0.79), SEA4 = vec3(0.00, 0.56, 0.73);
// 沙：干 → 最湿（淡紫灰）
const vec3 SAND0 = vec3(0.97, 0.93, 0.88), SAND1 = vec3(0.91, 0.85, 0.84), SAND2 = vec3(0.82, 0.76, 0.79), SAND3 = vec3(0.71, 0.67, 0.75);
const vec3 FOAM = vec3(0.98, 0.99, 0.98);
// 湿沙：被水泡过的沙子，比干沙深一点、偏黄（岸边那一圈都往这个颜色靠）
const vec3 WETSAND = vec3(0.93, 0.86, 0.72);

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// 颗粒和反光点用的随机数（Dave Hoskins 的 hash12）：对整数格子坐标也足够"乱"，不会排成行列
float hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec4 N(vec2 p, float scale) { return texture(uNoise, p / scale + uSeed * 0.013); }
float fieldS(sampler2D t, vec2 p) {
  vec2 edge = clamp(p, vec2(0.0), (uGrid - 1.0) * uStep);
  return texture(t, (edge / uStep + 0.5) / uGrid).r + length(p - edge);
}

vec3 seaRamp(float v) {
  v = clamp(v, 0.0, 1.0) * 4.0;
  if (v < 1.0) return mix(SEA0, SEA1, v);
  if (v < 2.0) return mix(SEA1, SEA2, v - 1.0);
  if (v < 3.0) return mix(SEA2, SEA3, v - 2.0);
  return mix(SEA3, SEA4, v - 3.0);
}
vec3 sandRamp(float v) {
  v = clamp(v, 0.0, 1.0) * 3.0;
  if (v < 1.0) return mix(SAND0, SAND1, v);
  if (v < 2.0) return mix(SAND1, SAND2, v - 1.0);
  return mix(SAND2, SAND3, v - 2.0);
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
// Worley（细胞）噪声：x = F1，y = F2。F2 - F1 很小的地方是细胞边界 → 用来画光网、碎沫网
vec2 worley(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), c = i + g;
    vec2 r = g + vec2(hash(c + uSeed), hash(c + uSeed + 17.3)) * 0.8 + 0.1 - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(sqrt(d1), sqrt(d2));
}
// 皮划艇船身：两头尖的梭形，返回有符号距离（<0 在船内）
float hullSD(vec2 q) {
  float L = 22.0, Wd = 5.4;
  float t = clamp(q.x / L, -1.0, 1.0);
  float w = Wd * (1.0 - t * t);
  return max(abs(q.y) - w, abs(q.x) - L);
}
float segSD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// 桨：一根细杆 + 两头红色桨叶
vec2 paddleSD(vec2 q, float ph) {
  float a = 1.5708 + sin(ph) * 0.55;
  vec2 dir = vec2(cos(a), sin(a)) , c = vec2(0.5, 0.0);
  float shaft = segSD(q, c - dir * 13.0, c + dir * 13.0) - 0.7;
  vec2 b1 = q - (c + dir * 13.5), b2 = q - (c - dir * 13.5);
  mat2 r = rot(-a);
  vec2 l1 = r * b1, l2 = r * b2;
  float blade = min(length(l1 / vec2(3.6, 1.6)) - 1.0, length(l2 / vec2(3.6, 1.6)) - 1.0) * 1.6;
  return vec2(shaft, blade);
}
// 海鸥（俯视，x 朝前）：返回 (身子, 翅膀, 翅膀上的位置 0 根 → 1 尖)；span = 翅膀展开程度，扇动时变短
vec3 gullSD(vec2 q, float span) {
  float body = (length((q - vec2(0.8, 0.0)) / vec2(6.2, 1.9)) - 1.0) * 1.9;
  float tail = max(abs(q.y) - 1.4 - (-q.x - 4.0) * 0.25, max(-q.x - 8.5, q.x + 4.0));
  float y = abs(q.y), reach = 15.0 * span;
  float u = clamp((y - 1.0) / reach, 0.0, 1.0);
  float lead = 1.0 + 1.3 * sin(u * 3.14159) - 4.0 * u * u;     // 前缘：中段微微前凸，翅尖向后掠
  float chord = mix(4.4, 1.3, u);
  float wing = max(max(q.x - lead, lead - chord - q.x), y - reach - 1.0);
  return vec3(min(body, tail), wing, u);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uScale - gl_FragCoord.y) / uScale;
  float t = uTime;
  // 喷绘颗粒：约 1.3px 的随机点（静止，像印刷纸面上的颗粒）
  vec2 gp = floor(p * (0.78 * max(uScale, 1.0)));   // 按屏幕的实际像素取颗粒（高分屏上不会变成一块块的小方块）
  // 用 hash2：旧 hash 对整数坐标每几十像素循环一次，最亮的颗粒会排成一格格的点阵
  float g1 = hash2(gp + 0.5), g2 = hash2(gp + 7.3);
  float gAmt = uGrain;

  float s0 = mix(fieldS(uFA, p), fieldS(uFB, p), uMix);
  float s = s0 + (N(p, 700.0).r - 0.5) * 10.0;

  // 浪的时钟：沿岸只有大尺度的先后差异，一长段海岸整齐地涌上来
  float wv = uWave;                                // 浪的大小：放大线宽、水雾
  float lam = uSpacing;                            // 浪的间距（px）
  // 沿岸的先后差异要很平缓：用最粗的一层噪声、放大尺度。原来 r 通道带 37px 的细节，
  // 沿岸走一百来像素浪的节奏就差四分之一拍，新浪的侧边从岸线陡直地立起来，两拍交界处白边戛然而止（像个缺口）
  float along = N(p, 4200.0).b * 1.2;
  float u = t * uSpeed / lam + along;             // 每 1.0 = 一道浪
  float fu = fract(u), cyc = floor(u);

  // 浪的能量：只有开阔海面才起浪。往陆地、往海各探一段：
  // 陆地太窄（探到对面的水）或水域太小（探不到深水）→ 浪减弱到平静
  vec2 gr = vec2(dFdx(s0), -dFdy(s0));
  vec2 nrm = length(gr) > 1e-4 ? normalize(gr) : vec2(0.0, 1.0);
  float sIn = mix(fieldS(uFA, p - nrm * 45.0), fieldS(uFB, p - nrm * 45.0), uMix);
  float sOut = mix(fieldS(uFA, p + nrm * 70.0), fieldS(uFB, p + nrm * 70.0), uMix);
  float energy = mix(ss(2.0, -18.0, sIn), 1.0, ss(15.0, 40.0, s)) * ss(25.0, 70.0, sOut);
  // 沙滩上（冲上来的薄水、湿沙带）用"岸线处"的能量：沿法线回到岸线上再往两边探。
  // 不能按像素自己的位置探——越往岸上离开阔水面越远、能量越小，薄水冲多远就取决于像素自己在哪，
  // 岸线一拐弯探的方向变得快，前沿就出现台阶和缺口
  // sW：薄水层用的"离岸距离"。往岸上走，岸线急拐弯处的等距线会收成尖角（湿痕、水膜前沿出现楔形），
  // 所以用周围 10px 的平均值把尖角磨圆；贴着水边时仍用原值，水膜和岸线对得上
  float shoreE = 0.0, sW = s;
  if (s < 4.0 && s > -uSigma * 0.78 - 12.0) {         // 只有薄水冲得到的那一条沙滩需要（再往里的干沙不用算）
    // 法线也用前后左右的差来算：dFdx 在场纹理每个 5px 格子边上会跳，拐角处探的位置跟着跳
    #define SF(q) mix(fieldS(uFA, q), fieldS(uFB, q), uMix)
    float fR = SF(p + vec2(10.0, 0.0)), fL = SF(p - vec2(10.0, 0.0)), fD = SF(p + vec2(0.0, 10.0)), fU = SF(p - vec2(0.0, 10.0));
    vec2 g10 = vec2(fR - fL, fD - fU);
    vec2 n10 = length(g10) > 1e-3 ? normalize(g10) : nrm;
    vec2 sp = p - n10 * s0;
    float eIn = SF(sp - n10 * 45.0), eOut = SF(sp + n10 * 70.0);
    shoreE = ss(2.0, -18.0, eIn) * ss(25.0, 70.0, eOut);
    sW = mix(s, (fR + fL + fD + fU) * 0.25 + (s - s0), ss(-2.0, -16.0, s));
  }

  vec3 col;
  if (s > 2.0) {
    // ---------- 海 ----------
    float depth = pow(clamp(max(s - uShoal * 0.45, 0.0) / (uShallow * 1.3), 0.0, 1.0), 0.62);
    col = seaRamp(depth + (g1 - 0.5) * 0.09 * gAmt);                               // 颗粒渐变

    // 斑驳光斑：扭曲后的噪声取阈值，边缘用颗粒打散；越近岸越密；缓慢流动
    vec2 drift = vec2(t * 2.2, t * 0.9);
    // 海面不画纹理：只有极淡、缓慢流动的大块明暗；深海零星闪烁的阳光反光点
    float deepK = ss(uShallow * 0.35, uShallow * 1.1, s);
    col *= 1.0 + (N(p + drift * 4.0, 1600.0).r - 0.5) * 0.07 * ss(0.0, uShoal + 40.0, s);
    // 阳光反光点：两层大小不同、互相旋转错开的格子，每格随机放一个点（位置、大小、闪烁节奏都随机），
    // 再按大尺度噪声成片聚集 → 看不出格子
    float glitter = ss(0.32, 0.72, N(p + drift * 3.0, 520.0).g) * deepK;
    float spark = 0.0;
    for (int L = 0; L < 2; L++) {
      float fl = float(L), cs = L == 0 ? 23.0 : 37.0;
      mat2 R = rot(L == 0 ? 0.62 : -1.13);
      vec2 q = R * p / cs + fl * 17.3;
      vec2 cell = floor(q), f = fract(q);
      vec2 seedc = cell + fl * 51.7 + uSeed * 0.1;
      if (hash2(seedc) > (L == 0 ? 0.11 : 0.16) * glitter) continue;
      vec2 c = 0.15 + 0.7 * vec2(hash2(seedc + 1.3), hash2(seedc + 2.9));
      float life = fract(t * (0.3 + 0.35 * hash2(seedc + 8.1)) + hash2(seedc + 5.7));
      float tw = ss(0.0, 0.1, life) * (1.0 - ss(0.2, 0.45, life));
      float r = 0.7 + 0.9 * hash2(seedc + 3.3);
      spark = max(spark, (1.0 - ss(r * 0.5, r * 1.5, length((f - c) * cs))) * tw);
    }
    col = mix(col, vec3(0.95, 1.0, 1.0), spark * 0.85);

    // 透明浅滩：水浅到能看见沙底，越往外越被青绿色盖住（过渡同样用颗粒喷出来）
    float shoal = uShoal;
    float k = clamp(ss(shoal * 0.15, shoal * 1.25, s) + (g2 - 0.5) * 0.16 * gAmt, 0.0, 1.0);
    if (k < 1.0) {
      vec3 bed = mix(vec3(0.97, 0.91, 0.79), vec3(0.88, 0.90, 0.77), ss(0.0, shoal, s));
      vec3 tint = mix(vec3(0.93, 0.99, 0.96), vec3(0.62, 0.92, 0.88), ss(0.0, shoal * 0.9, s));
      col = mix(bed * tint, col, k);
    }
    // 贴岸的一段水底是湿沙：从岸线处的湿沙色慢慢过渡到浅滩的沙底色，和沙滩那边接得上，水里没有一道边
    col = mix(col, mix(sandRamp((g1 - 0.5) * 0.1 * gAmt), WETSAND, 0.6), 1.0 - ss(2.0, 38.0, s));

    // 皮划艇的影子（清澈的水，影子落在海底）
    float shadow = 0.0;
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uKayN) break;
      vec4 k = uKay[i];
      vec2 q2 = rot(-k.z) * (p - k.xy - vec2(8.0, 13.0));
      float sd = hullSD(q2);
      vec2 pd = paddleSD(q2, k.w);
      shadow = max(shadow, ss(1.6, -1.6, min(sd, min(pd.x, pd.y))));
    }
    col = mix(col, col * vec3(0.62, 0.78, 0.84), shadow * 0.7);

    // 涟漪：细白圈
    float rip = 0.0;
    for (int i = 0; i < 6; i++) {
      vec4 r = uRip[i];
      if (r.w <= 0.0) continue;
      float dist = length(p - r.xy), rad = r.z * 80.0;
      rip = max(rip, (1.0 - ss(0.8, 2.0, abs(dist - rad))) * exp(-r.z * 1.4) * r.w);
      rip = max(rip, (1.0 - ss(0.6, 1.6, abs(dist - rad * 0.6))) * exp(-r.z * 1.8) * r.w * 0.6);
    }
    col = mix(col, FOAM, step(g2, rip * 0.95));

    // ---------- 海里的浪 ----------
    float dd = s - 2.0;
    // 远一点的浪线：向岸推进，到岸的那一刻正好推出一层薄水
    float ph = (s + t * uSpeed) / lam + along;
    float fr = fract(ph);
    float dpx = min(fr, 1.0 - fr) * lam;
    // 浪从远处推进到岸边：离岸约 1.35 个浪距处淡淡出现，越近越实（海里平时只有一道浪线）；一直推到水边才消失（不提前淡出，
    // 否则浪线没到岸就没了，到岸那一下的水雾像是凭空冒出来的）
    float vis = (1.0 - ss(lam * 0.45, lam * 1.35, s)) * ss(0.0, 4.0, dd) * energy;
    // 靠近岸开始破碎：浪线变粗、更白，身后的颗粒水雾更多
    float brk = 1.0 - ss(8.0, 55.0, s);
    float cw = wv * (1.0 + 0.8 * brk);
    float crest = (1.0 - ss(0.7 * cw, 1.9 * cw, dpx)) * vis * (0.55 + 0.4 * brk);
    float crestSpray = exp(-fr * lam / (7.0 * cw)) * vis * (0.25 + 0.4 * brk);        // 浪线后方的颗粒水雾
    // 浪到岸的那一刻再轻轻迸一下水雾（只是推上来的浪的延续，不是主角）
    float burst = exp(-fu * 4.5) * ss(0.0, 0.04, fu);
    float spray = exp(-dd / (6.0 * wv)) * burst * energy * 0.45;
    float foam = max(crest, step(g2, max(spray, crestSpray)));
    col = mix(col, FOAM, foam);
  } else {
    // ---------- 沙滩（干沙 + 靠水的一窄条常湿带）----------
    float wet = ss(-7.0 - 3.0 * shoreE, 1.0, s) * 0.2;
    col = mix(sandRamp((g1 - 0.5) * 0.1 * gAmt), WETSAND, wet * 3.0);
    col *= 1.0 - 0.03 * ss(0.4, 0.8, N(p, 900.0).r) * (1.0 - wet);               // 干沙上极轻的大块明暗
  }

  // ---------- 一层层冲上沙滩的薄水 ----------
  // 同时有 3 层：各自推进 → 停住 → 回落，最高点各不相同；前沿一道颗粒白边，退去后留下慢慢消失的湿痕
  // 冲得再高也不淹到图标：图标边缘大约在 s ≈ -离岸距离 处，留出余量
  // ×0.25：开阔岸边冲浪幅度 120 时约冲上 30px，和原来（按像素位置探能量时实际达到的）一样
  float reachBase = min(uRunup * 0.25 * shoreE * (0.85 + 0.3 * N(p, 900.0).g), uSigma * 0.78);
  // 薄水、湿痕不在岸线处一刀切：往海里再延伸一段、慢慢淡出（开阔岸边才有，小水塘里没有浪）
  float wk = (1.0 - ss(2.0, 38.0, s)) * mix(1.0, energy, ss(2.0, 10.0, s));
  if ((s < 4.0 && reachBase > 0.5) || (s >= 4.0 && wk > 0.01)) {
    const vec3 FILM = WETSAND, MARK = WETSAND * 0.97;
    float onSand = step(s, 4.0);                                                  // 前沿白边只画在沙滩上
    // 薄水退去时留下的网状碎沫（跟着回流的水往海里漂）
    vec2 wl = worley((p - nrm * fu * 8.0) / 7.0);
    float laceNet = (1.0 - ss(0.03, 0.1, wl.y - wl.x)) * ss(0.4, 0.62, N(p + vec2(t * 2.0, 0.0), 120.0).g);
    float wetMem = 0.0, filmA = 0.0;
    vec4 layers[3];
    for (int j = 0; j < 3; j++) {
      float a = fu + float(j);                                                    // 这一层的"年龄"（单位：一道浪的周期）
      float amp = reachBase * (0.5 + 0.5 * hash(vec2(cyc - float(j), 3.7)));
      float front = a < 0.45 ? mix(3.0, -amp, 1.0 - pow(1.0 - a / 0.45, 2.2))    // 推进：先快后慢
                             : mix(-amp, 3.0, ss(0.45, 1.4, a));                  // 回落
      float reached = ss(-amp - 4.0, -amp + 12.0, sW);                         // 边缘很软：不留一道线
      wetMem = max(wetMem, reached * (1.0 - ss(0.45, 2.8, a)) * ss(0.2, 0.45, a));
      float alpha = a < 0.45 ? 0.42 : 0.42 * (1.0 - ss(0.45, 1.4, a));
      // 回落的水边会越退越薄、没有清楚的边：上沿逐渐羽化，和后面冲上来的浪交叉时不会出现一个硬角（缺口）
      float feather = 1.0 + 16.0 * ss(0.45, 1.1, a);
      filmA = max(filmA, ss(front - 1.0, front + feather, sW) * alpha * 1.6);
      layers[j].w = feather;
      layers[j].xyz = vec3(front, a, amp);
    }
    // 湿痕：水到过的地方沙子更深一点（偏黄的湿沙色），只是淡淡一层
    col = mix(col, MARK, wetMem * 0.18 * wk);
    // 冲上来的薄水：几层重叠的地方只算最厚的那层（一层层相乘会越叠越暗）。
    // 被水盖住的沙子变成偏黄的湿沙色（一部分相乘、保留下面沙子的颗粒；一部分直接往湿沙色靠）。
    // 不能乘青绿：偏粉的沙子乘上青绿会互相抵消成灰色，岸边一圈发暗
    col = mix(col, mix(col * vec3(0.98, 0.96, 0.90), FILM, 0.6), filmA * wk);
    // 由老到新画薄水层的碎沫和白边
    for (int j = 2; j >= 0; j--) {
      float front = layers[j].x, a = layers[j].y, amp = layers[j].z;
      float cov = ss(front - 1.0, front + layers[j].w, sW);
      float lace = laceNet * cov * ss(0.4, 0.6, a) * (1.0 - ss(0.7, 1.4, a)) * wk;
      col = mix(col, FOAM, lace * 0.75);
      float edgeK = a < 0.45 ? 1.0 : 1.0 - ss(0.45, 1.05, a);
      float d = sW - front;
      float lineE = (1.0 - ss(0.8 * wv, 1.9 * wv, abs(d - 0.9 * wv))) * edgeK * onSand;    // 前沿白边
      float sprayE = exp(-max(d, 0.0) / (5.0 * wv)) * cov * edgeK * 0.5 * onSand;         // 白边身后的颗粒水雾
      col = mix(col, FOAM, max(lineE * 0.95, step(g1, sprayE)));
    }
  }

  // ---------- 皮划艇 ----------
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uKayN) break;
    vec4 k = uKay[i];
    vec2 q = rot(-k.z) * (p - k.xy);
    if (dot(q, q) > 900.0) continue;
    float sd = hullSD(q);
    vec2 pd = paddleSD(q, k.w);
    // 桨在船下面的部分先画
    vec3 kc = col;
    float a = 0.0;
    float mh = ss(0.7, -0.7, sd);
    if (mh > 0.0) {
      float tt = clamp(q.x / 22.0, -1.0, 1.0);
      float wd = 5.4 * (1.0 - tt * tt);
      vec3 hull = mix(vec3(0.99, 0.84, 0.16), vec3(1.0, 0.93, 0.45), 1.0 - ss(0.2, 0.7, abs(q.y) / max(wd, 0.5)));
      hull = mix(hull, vec3(0.90, 0.64, 0.10), ss(0.78, 1.0, abs(q.y) / max(wd, 0.5)));
      // 甲板上的白色小圆点（舱口盖）
      hull = mix(hull, vec3(0.97, 0.96, 0.9), 1.0 - ss(1.0, 1.6, length(q - vec2(13.0, 0.0))));
      hull = mix(hull, vec3(0.97, 0.96, 0.9), 1.0 - ss(1.0, 1.6, length(q - vec2(-12.0, 0.0))));
      // 座舱
      hull = mix(hull, vec3(0.30, 0.24, 0.20), 1.0 - ss(0.0, 0.6, length((q - vec2(-1.0, 0.0)) / vec2(6.0, 2.8)) - 1.0));
      kc = mix(kc, hull, mh); a = max(a, mh);
    }
    // 人：橙色救生衣 + 深色头
    float body = ss(0.5, -0.5, length(q - vec2(-1.5, 0.0)) - 3.3);
    kc = mix(kc, vec3(0.96, 0.55, 0.18), body);
    float head = ss(0.5, -0.5, length(q - vec2(0.2, 0.0)) - 2.0);
    kc = mix(kc, vec3(0.22, 0.17, 0.16), head);
    // 桨
    float sh = ss(0.5, -0.5, pd.x), bl = ss(0.5, -0.5, pd.y);
    kc = mix(kc, vec3(0.28, 0.24, 0.26), sh);
    kc = mix(kc, vec3(0.90, 0.28, 0.22), bl);
    col = kc;
  }

  // ---------- 海鸟：白身子、浅灰翅膀、黑翅尖的海鸥，飞得高，影子落得远 ----------
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uBirdN) break;
    vec4 b = uBird[i];
    vec2 d0 = p - b.xy, d1 = d0 - vec2(34.0, 55.0);
    if (dot(d1, d1) < 400.0) {
      vec3 g = gullSD(rot(-b.z) * d1, b.w);
      col = mix(col, col * vec3(0.70, 0.74, 0.84), ss(1.8, -1.8, min(g.x, g.y)) * 0.28);
    }
    if (dot(d0, d0) < 400.0) {
      vec3 g = gullSD(rot(-b.z) * d0, b.w);
      vec3 wingC = mix(vec3(0.80, 0.84, 0.88), vec3(0.20, 0.22, 0.26), ss(0.72, 0.8, g.z));
      col = mix(col, wingC, ss(0.6, -0.6, g.y));
      col = mix(col, vec3(0.99, 0.99, 0.98), ss(0.6, -0.6, g.x));
      col = mix(col, vec3(0.98, 0.78, 0.22), ss(0.5, -0.5, length(rot(-b.z) * d0 - vec2(7.2, 0.0)) - 0.9));   // 黄嘴
    }
  }

  if (uDebug > 0.5) col = mix(col, vec3(0.9, 0.15, 0.15), 1.0 - ss(0.0, 1.5, abs(s0)));
  // 印刷感：整体再叠一层极轻的颗粒
  col *= 1.0 + (g2 - 0.5) * 0.035 * gAmt;
  o = vec4(col, 1.0);
}`

/* ======================================================================
   WebGL
   ====================================================================== */
