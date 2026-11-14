import { chooseMeadowCats } from './meadowCats'
import {
  meadowClickTarget,
  meadowMoveFacing,
  meadowResizeEntry,
  meadowRunFrame,
} from './meadowMotion'
import type { MeadowAssets, MeadowProgram, MeadowRegion } from './meadowScene'

type Point = { x: number; y: number }
type Vec2 = [number, number]
type Vec3 = [number, number, number]
type Vec4 = [number, number, number, number]
const BACK_RUN_FEET: Vec2[] = [
  [-7.2, 69.1],
  [-2.4, 72.1],
  [25.9, 71.2],
  [-1.9, 67.8],
  [-3.2, 66.9],
  [21, 70.8],
  [27.8, 70.4],
  [-7.8, 69.5],
  [-5.8, 69.5],
]
const FRONT_RUN_FEET: Vec2[] = [
  [14.7, 72.9],
  [-0.9, 70.4],
  [-0.3, 72.5],
  [12.7, 73.4],
  [15.3, 69.5],
  [18, 74.7],
  [15.3, 77.2],
  [15.9, 75.5],
  [17.7, 77.2],
]
type Activity = {
  frame: number
  back: boolean
  progress: number
  running: boolean
  squeeze: number
  bob: number
  done: boolean
  phase?: number
  gait?: number
}
type Tug = { active: boolean; reach: number; pull: number }
type Trip = {
  start: number
  from: Point
  to: Point
  duration?: number
  cycles?: number
  after?: Point
  enter?: boolean
  exit?: boolean
  click?: boolean
  front?: boolean
}
type BoyState = { position: Point; home: Point; layout: string; routeTarget: Point | null }
type Boy = {
  state: BoyState
  rect?: Vec4
  shadow?: WebGLTexture | null
  actor?: WebGLTexture | null
}

export function createMeadowCharacters({
  gl,
  cv,
  resolution,
  program,
  assets,
  pendingImages,
  isDisposed,
  getScene,
}: {
  gl: WebGL2RenderingContext
  cv: HTMLCanvasElement
  resolution: { scale: number }
  program: (source: string) => MeadowProgram
  assets: MeadowAssets
  pendingImages: Set<HTMLImageElement>
  isDisposed: () => boolean
  getScene: () => {
    width: number
    height: number
    seed: number
    regions: MeadowRegion[]
    options: { sigma: number; avoidCenter: boolean }
  }
}) {
  const TASKBAR = 0
  let W = 0,
    H = 0,
    seed = 0,
    regions: MeadowRegion[] = [],
    P = { sigma: 72, avoidCenter: false }

  const syncScene = () => {
    const scene = getScene()
    W = scene.width
    H = scene.height
    seed = scene.seed
    regions = scene.regions
    P = scene.options
  }

  let meadowBoyScene: ReturnType<typeof createMeadowBoyScene> | null = null
  const meadowBoyRunDuration = 2,
    meadowBoyTurnDuration = 0.22,
    runFrameSpeed = 0.6

  const meadowBoyTripPose = (
    elapsed: number,
    cycles = 4,
    duration = meadowBoyRunDuration,
    trip: { enter?: boolean; exit?: boolean; front?: boolean } = {},
  ): Activity => {
    const ease = (t: number) => {
      t = Math.max(0, Math.min(1, t))
      return t * t * (3 - 2 * t)
    }
    const turn = trip.enter || trip.front ? 0 : meadowBoyTurnDuration
    const runEnd = turn + duration,
      turnBackAt = runEnd + 0.18
    const strideLead = trip.enter ? 0 : 0.07
    if (elapsed < turn - strideLead) {
      const t = Math.max(0, elapsed / turn)
      return {
        frame: t < 0.25 ? 3 : t < 0.68 ? 0 : 3,
        back: t >= 0.25,
        progress: 0,
        running: false,
        squeeze: 1 - 0.2 * Math.sin(t * Math.PI),
        bob: 0,
        done: false,
      }
    }
    if (elapsed < runEnd) {
      const runTime = elapsed - turn,
        stepTime = Math.max(0, runTime + strideLead),
        plantTime = trip.enter ? 0 : 0.02
      // 转身最后 70ms 就开始迈步，转完仅留 20ms 落脚；加速时间不随整段路程拉长。
      const moveTime = Math.max(0, runTime - plantTime),
        moveDuration = duration - plantTime
      const accelerate = 0.16,
        decelerate = 0.22
      const rampIntegral = (t: number, r: number) => {
        if (t >= r) return t - r * 0.5
        const u = Math.max(0, t / r)
        return r * (u * u * u - 0.5 * u * u * u * u)
      }
      const progress = Math.max(
        0,
        Math.min(
          1,
          (rampIntegral(moveTime, accelerate) -
            rampIntegral(Math.max(0, moveTime - moveDuration + decelerate), decelerate)) /
            (moveDuration - (accelerate + decelerate) * 0.5),
        ),
      )
      const lead = trip.enter ? 0 : 0.18
      const phase = (lead * ease(stepTime / 0.1) + (cycles - lead) * progress) * Math.PI * 2
      const gait = ease(stepTime / 0.07) * ease((duration - runTime) / 0.12)
      const squeeze = elapsed < turn ? 1 - 0.2 * Math.sin((elapsed / turn) * Math.PI) : 1
      return {
        frame: 3,
        back: true,
        progress,
        running: true,
        squeeze,
        phase,
        gait,
        bob: -(1 - Math.cos(phase * 2)) * 0.65 * gait,
        done: false,
      }
    }
    if (trip.exit)
      return { frame: 3, back: true, progress: 1, running: false, squeeze: 1, bob: 0, done: true }
    if (trip.front)
      return { frame: 3, back: false, progress: 1, running: false, squeeze: 1, bob: 0, done: true }
    if (elapsed < turnBackAt)
      return { frame: 3, back: true, progress: 1, running: false, squeeze: 1, bob: 0, done: false }
    if (elapsed < turnBackAt + meadowBoyTurnDuration) {
      const t = (elapsed - turnBackAt) / meadowBoyTurnDuration
      return {
        frame: t < 0.32 ? 3 : 0,
        back: t < 0.75,
        progress: 1,
        running: false,
        squeeze: 1 - 0.2 * Math.sin(t * Math.PI),
        bob: 0,
        done: false,
      }
    }
    return { frame: 3, back: false, progress: 1, running: false, squeeze: 1, bob: 0, done: true }
  }

  const meadowBoyGroundPose = (
    activity: Activity,
    pose: ReturnType<typeof meadowBoyPose>,
    runFrame: number,
  ) => {
    if (runFrame >= 0) {
      const foot = (activity.back ? BACK_RUN_FEET : FRONT_RUN_FEET)[runFrame]!
      const x = foot[0] * activity.squeeze
      const y = foot[1] + activity.bob
      const slope = activity.back ? -0.19 : 0
      return {
        line: [slope, y - slope * x] as Vec2,
        contacts: [
          [x, y, 1],
          [0, 0, 0],
        ] as Vec3[],
      }
    }
    let feet: Vec2[]
    if (activity.back) {
      const rest: Vec2[] =
        activity.frame === 0
          ? [
              [-10.06, 78.11],
              [23.76, 72.66],
            ]
          : [
              [-15.52, 72.94],
              [17.58, 66.63],
            ]
      feet = rest.map((p) => [p[0] * activity.squeeze, p[1] + activity.bob - 10])
    } else {
      feet = [
        [-22.5 * activity.squeeze - pose.legs[0] * 0.24 * activity.squeeze, 72 - pose.legs[0]],
        [37.8 * activity.squeeze + pose.legs[1] * 0.24 * activity.squeeze, 63.3 - pose.legs[1]],
      ]
    }
    const dx = feet[1]![0] - feet[0]![0]
    const spacing = Math.sign(dx || 1) * Math.max(12, Math.abs(dx))
    const slope = Math.max(-0.8, Math.min(0.5, (feet[1]![1] - feet[0]![1]) / spacing))
    const intercept = (feet[0]![1] + feet[1]![1] - slope * (feet[0]![0] + feet[1]![0])) * 0.5
    return {
      line: [slope, intercept] as Vec2,
      contacts: feet.map((p): Vec3 => [p[0], p[1] - 0.5, 1]),
    }
  }

  const meadowBoyRunDestination = (
    from: Point,
    s: number,
    _width: number,
    height: number,
    taskbar: number,
  ) => {
    const distance = Math.min(Math.max(165, (height - taskbar) * 0.27), 315)
    // 接近上沿就继续跑出整个人物、风筝与投影，不在边缘停成半截。
    const exit = from.y - distance < 116 * s + 24
    const y = exit ? -610 * s - 24 : from.y - distance
    // 保留向左斜上方的路线；窄屏接近左边时让路线变陡，避免从侧面消失。
    const x = Math.max(96 * s + 12, from.x - (from.y - y) * 0.65)
    return { x, y, exit }
  }

  const meadowBoyTugPose = (age: number) => {
    const ease = (t: number) => {
      t = Math.max(0, Math.min(1, t))
      return t * t * (3 - 2 * t)
    }
    if (age < 0 || age >= 1.12) return { active: false, reach: 0, pull: 0 }
    const reach = ease(age / 0.16) * (1 - ease((age - 0.16) / 0.2))
    const pull = ease((age - 0.16) / 0.2) * (1 - ease((age - 0.5) / 0.62))
    return { active: true, reach, pull }
  }

  const meadowBoyKiteReaction = (
    reaction: { x: number; y: number; vx: number; vy: number; angle: number; spin: number },
    dt: number,
    impulse: number,
  ) => {
    // 手把线拉紧时给风筝一次冲量，弹性回复与阻尼使它摆过头后逐渐停稳。
    reaction.vx -= 100 * impulse
    reaction.vy -= 120 * impulse
    reaction.spin += 2.8 * impulse
    reaction.vx += (-18 * reaction.x - 3.4 * reaction.vx) * dt
    reaction.vy += (-22 * reaction.y - 4 * reaction.vy) * dt
    reaction.spin += (-24 * reaction.angle - 3.8 * reaction.spin) * dt
    reaction.x += reaction.vx * dt
    reaction.y += reaction.vy * dt
    reaction.angle += reaction.spin * dt
  }

  const meadowBoyWavePull = (time: number, tug: Tug) => {
    if (tug.active) return 0
    const wave = Math.max(0, Math.min(1, ((time % 9) - 4) / 0.6))
    return Math.pow(Math.sin(Math.PI * wave), 2)
  }

  const meadowBoyPose = (time: number, tug: Tug = { active: false, reach: 0, pull: 0 }) => {
    const pull = Math.pow(0.5 + 0.5 * Math.sin(time * 1.35), 3)
    const shift = Math.sin(time * 1.05)
    const body: Vec2 = [
      Math.sin(time * 0.85) * 1.7 - tug.pull * 1.8,
      Math.sin(time * 1.7) * 0.65 - tug.pull * 0.8,
    ]
    const tugOffset: Vec2 = [tug.reach * 4 - tug.pull * 12, tug.reach * 3 - tug.pull * 8]
    // 保持头部朝向，不再左右镜像转头。
    const look = 1
    // 平时保持抬手姿势，每隔九秒快速挥动一次，约 0.6 秒内挥出再收回。
    const reel = -0.18 + (tug.active ? -tug.pull * 0.22 : meadowBoyWavePull(time, tug) * 1.14)
    // 素材中右手在线轮下方握柄；端点和抬手部件共用肩关节、角度及拉线位移。
    const angle = reel + 0.18,
      c = Math.cos(angle),
      s = Math.sin(angle)
    const armPoint = (x: number, y: number): Vec2 => {
      const q: Vec2 = [
        -21 + c * (x + 21) - s * (y + 9) - tugOffset[0] * 0.35,
        -9 + s * (x + 21) + c * (y + 9) - tugOffset[1] * 0.35,
      ]
      const py = (q[1] + (body[1] * 78) / 170) / (1 + body[1] / 170)
      return [q[0] + (body[0] * (78 - py)) / 170, py]
    }
    const reelHand = armPoint(-49, -45.5)
    return {
      head: 0,
      look,
      nod: Math.sin(time * 0.9 + 0.4) * 1.5,
      reel,
      pull,
      tugOffset,
      body,
      legs: [Math.max(0, shift) * 3.8, Math.max(0, -shift) * 3.2] as Vec2,
      hand: [...reelHand] as Vec2,
      reelHand,
    }
  }

  const prepareMeadowBoy = (now: number, visible = true) => {
    if (!meadowBoyScene) meadowBoyScene = createMeadowBoyScene()
    return meadowBoyScene.draw(now, visible)
  }

  const createMeadowBoyScene = () => {
    const shader = program(`#version 300 es
precision highp float;
uniform sampler2D uCharacter, uRunSprite, uFrontRunSprite, uBackRunSprite;
uniform vec2 uRes, uOffset, uKite, uBody, uLegs, uHand, uReelHand, uTug;
uniform vec4 uPose, uMotion;
uniform vec2 uGround;
uniform vec3 uContactL, uContactR;
uniform vec3 uPlace;
uniform float uScale, uTime, uLook, uShadow, uRunWind, uTension, uKiteRock, uFacing;
uniform float uRunFrame;
out vec4 o;
vec4 over(vec4 base, vec4 top) {
  float alpha=top.a+base.a*(1.-top.a);
  return vec4((top.rgb*top.a+base.rgb*base.a*(1.-top.a))/max(alpha,.001),alpha);
}
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 v=b-a;return length(p-a-v*clamp(dot(p-a,v)/max(dot(v,v),.001),0.,1.));
}
vec2 turn(vec2 p,float angle) {
  float c=cos(angle),s=sin(angle);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);
}
vec2 bodySpace(vec2 p) {
  return p-uBody*clamp((78.-p.y)/170.,0.,1.);
}
float armMask(vec2 p) {
  float boundary=p.y < -30. ? -38.+(-p.y-30.)*.10 : min(-17.,-38.+(p.y+30.)*.78);
  return (1.-smoothstep(boundary-.45,boundary+.45,p.x))*(1.-smoothstep(0.,3.,p.y));
}
vec4 spriteColor(vec4 color,vec2 p) {
  color.a*=step(-76.,p.x)*step(-95.,p.y)*step(p.x,76.)*step(p.y,85.);
  return color;
}
vec2 spriteUV(vec2 p) {
  return clamp((p+vec2(76.,95.))/vec2(152.,180.),.002,.998);
}
vec2 personSource(vec2 p) {
  vec2 boy=bodySpace(p);
  vec2 rest=boy;
  // 站着交替提脚、挪重心；膝盖往上逐渐固定，裤腿不会被整体拉走。
  float lower=smoothstep(24.,48.,rest.y);
  float right=smoothstep(-4.,9.,rest.x);
  float lift=mix(uLegs.x,uLegs.y,right);
  boy.y+=lift*lower;
  boy.x-=(right*2.-1.)*lift*.24*lower;
  return boy;
}
float ribbon(vec2 p,float offset,float phase) {
  float t=clamp(p.y/108.,0.,1.);
  float gust=sin(t*5.6-uTime*4.8+phase)*uRunWind*9.+sin(t*6.-uTime*7.+phase)*abs(uKiteRock)*12.;
  float center=offset+50.*t+(12.*sin(t*4.8-uTime*1.15+phase)+gust)*t;
  float width=mix(3.4,1.6,t);
  return (1.-smoothstep(width,width+1.,abs(p.x-center)))*step(0.,p.y)*step(p.y,108.);
}
float kiteAngle() {
  return -.23+sin(uTime*.7)*.09+sin(uTime*4.8+.7)*uRunWind*.24+uKiteRock;
}
vec4 kiteColor(vec2 p,vec2 screen) {
  vec4 result=vec4(0.);
  float angle=kiteAngle();
  vec2 delta=p-uKite;
  vec2 q=vec2(cos(angle)*delta.x+sin(angle)*delta.y,-sin(angle)*delta.x+cos(angle)*delta.y);
  vec2 tail=q-vec2(2.,65.);
  result=over(result,vec4(.88,.65,.37,ribbon(tail,0.,0.)));
  result=over(result,vec4(.81,.39,.30,ribbon(tail,8.,.45)));
  result=over(result,vec4(.32,.55,.62,ribbon(tail,16.,.9)));
  float diamond=abs(q.x)/53.+abs(q.y)/70.;
  float coverage=1.-smoothstep(mix(.97,.94,uShadow),mix(1.025,1.07,uShadow),diamond);
  vec3 fabric=q.y<0.?(q.x<0.?vec3(.95,.77,.42):vec3(.88,.43,.33)):
    (q.x<0.?vec3(.94,.77,.44):vec3(.35,.57,.64));
  float grain=fract(sin(dot(floor(screen*1.7),vec2(12.9898,78.233)))*43758.5453);
  fabric*=.97+grain*.06;
  fabric=mix(fabric,vec3(.46,.40,.25),smoothstep(.93,1.0,diamond)*.78);
  float seams=1.-smoothstep(.35,.9,min(abs(q.x),abs(q.y)));
  fabric=mix(fabric,vec3(.98,.92,.71),seams*.65);
  return over(result,vec4(fabric,coverage));
}
vec4 rigJoint(vec2 p,vec2 center,vec3 color,float radius) {
  float d=length(p-center);
  vec4 edge=vec4(.26,.18,.12,1.-smoothstep(radius+.2,radius+.8,d));
  return over(edge,vec4(color,1.-smoothstep(radius-.6,radius,d)));
}
vec4 characterColor(vec2 p) {
  p.x*=uFacing;
  p.x/=uMotion.z;
  if(uRunFrame>=0.) {
    // 每次只取一格，不叠加相邻帧；列间偏移校正素材中的排版误差。
    float col=mod(uRunFrame,3.);
    vec2 cell=vec2(col,floor(uRunFrame/3.));
    vec2 uv=spriteUV(p-vec2(0.,uMotion.w));
    uv.x=clamp(uv.x-col*26./418.,.002,.998);
    return spriteColor(uMotion.y>.5
      ? textureLod(uBackRunSprite,(uv+cell)/3.,uShadow*2.8)
      : textureLod(uFrontRunSprite,(uv+cell)/3.,uShadow*2.8),p);
  }
  vec2 boy=personSource(p),space=bodySpace(p);
  // 直接使用新男孩全身素材；右手本来就在画面左侧，不再镜像人物或拼旧身体。
  vec2 pivot=vec2(-21.,-9.);
  vec2 armSource=pivot+turn(space+uTug*.35-pivot,-(uPose.z+.18));
  float lod=uShadow*2.8;
  vec4 person=spriteColor(textureLod(uCharacter,spriteUV(boy),lod),boy);
  vec4 arm=spriteColor(textureLod(uCharacter,spriteUV(armSource),lod),armSource);
  person.a*=1.-armMask(boy);
  arm.a*=armMask(armSource);
  // 肩关节留在手臂后面，挥手和拉线时袖口不会断开。
  vec4 shoulder=rigJoint(space,pivot,vec3(.90,.22,.16),5.0);
  vec4 front=over(over(person,shoulder),arm);
  vec2 runPoint=p-vec2(0.,uMotion.w-10.);
  vec2 cell=vec2(step(1.5,uMotion.x),0.);
  vec4 back=spriteColor(textureLod(uRunSprite,(spriteUV(runPoint)+cell)*vec2(.5,1.),lod),runPoint);
  return uMotion.y>.5 ? back : front;
}
void main() {
  vec2 screen=uOffset+vec2(gl_FragCoord.x/uScale,uRes.y-gl_FragCoord.y/uScale);
  vec2 p=(screen-uPlace.xy)/uPlace.z;
  // 投影经过当前鞋底的地面位置，保持向右下的光向，不再使用固定的离地偏移。
  float sy=(p.y-uGround.x*p.x-uGround.y)/(uGround.x*.46-.64);
  vec2 projected=vec2(p.x+.46*sy,uGround.x*(p.x+.46*sy)+uGround.y+sy);
  vec2 personPoint=mix(p,projected,uShadow);
  vec4 person=characterColor(personPoint);
  // 风筝较高：整只风筝与三条尾带一起投影，方向和云影一致。
  vec4 kite=kiteColor(p-uShadow*vec2(98.,134.),screen);
  vec2 hand=uHand,attach=uKite+turn(vec2(-41.,-16.),kiteAngle());
  vec2 control=mix(hand,attach,.5)+vec2(-13.+sin(uTime*.8)*6.,18.)*(1.-uTension*.85);
  float line=1e5;vec2 previous=hand;
  for(int i=1;i<=6;i++) {
    float t=float(i)/6.;vec2 point=mix(mix(hand,control,t),mix(control,attach,t),t);
    line=min(line,segment(p,previous,point));previous=point;
  }
  // 线从高举的线轮伸出，经过人物前方时仍可见，避免看起来从头或脚处起线。
  vec4 result=over(kite,person);
  result=over(result,vec4(.94,.92,.77,(1.-smoothstep(.4,1.1,line))*.94));
  float contactL=(1.-smoothstep(.65,1.15,length((p-uContactL.xy)/vec2(7.,2.6))))*uContactL.z;
  float contactR=(1.-smoothstep(.65,1.15,length((p-uContactR.xy)/vec2(7.,2.6))))*uContactR.z;
  float silhouette=max(max(person.a,kite.a),max(contactL,contactR));
  o=mix(result,vec4(vec3(silhouette),1.),uShadow);
}`)
    const texture = gl.createTexture(),
      runTexture = gl.createTexture(),
      frontFramesTexture = gl.createTexture(),
      backFramesTexture = gl.createTexture()
    const framebuffer = gl.createFramebuffer(),
      layers: [WebGLTexture | null, WebGLTexture | null] = [gl.createTexture(), gl.createTexture()]
    let targetWidth = 0,
      targetHeight = 0
    let ready = 0,
      position: Point | null = null,
      target: Point | null = null,
      signature = '',
      previousTime: number | null = null,
      time = 0
    let trip: Trip | null = null,
      nextRunAt = 7,
      kitePosition: Point | null = null,
      lastScale = 0,
      returnAt: number | null = null
    let home: Point | null = null,
      homeAvoidCenter = false,
      pendingMove: Point | null = null
    let frontReady = false,
      backReady = false,
      standingMirror = false
    let nextPullAt = 2.2,
      pullStarted = -Infinity,
      lastLinePull = 0
    const kiteReaction = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, spin: 0 }
    const startTrip = (
      from: Point,
      to: Point,
      s: number,
      flags: { enter?: boolean; exit?: boolean; click?: boolean } = {},
    ): Trip => {
      const distance = Math.hypot(to.x - from.x, to.y - from.y)
      const cycles = Math.max(2, Math.round(distance / (s * 80)))
      return {
        start: time,
        from: { ...from },
        to: { x: to.x, y: to.y },
        // 长路程增加迈步次数，保留清楚的收腿动作，不靠加快步频赶完。
        duration: Math.max(meadowBoyRunDuration, distance / 55, cycles * 0.52),
        cycles,
        ...flags,
        front: !!flags.click && to.y >= from.y,
      }
    }
    const loadSprite = (
      path: string,
      unit: number,
      targetTexture: WebGLTexture | null,
      size = 384,
      onLoad = () => {
        ready++
      },
      heightRatio = 1,
    ) => {
      const image = new Image()
      pendingImages.add(image)
      image.onload = () => {
        pendingImages.delete(image)
        if (isDisposed()) return
        const sprite = document.createElement('canvas')
        sprite.width = size
        sprite.height = size * heightRatio
        sprite.getContext('2d')!.drawImage(image, 0, 0, sprite.width, sprite.height)
        gl.activeTexture(unit)
        gl.bindTexture(gl.TEXTURE_2D, targetTexture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sprite)
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        onLoad()
      }
      image.onerror = () => {
        pendingImages.delete(image)
        if (!isDisposed()) console.warn('草地人物素材加载失败：' + path)
      }
      image.src = path
    }
    loadSprite(assets.boy, gl.TEXTURE4, texture)
    loadSprite(assets.boyRun, gl.TEXTURE7, runTexture, 768, undefined, 0.5)
    loadSprite(assets.boyFrontFrames, gl.TEXTURE10, frontFramesTexture, 960, () => {
      frontReady = true
    })
    loadSprite(assets.boyBackFrames, gl.TEXTURE11, backFramesTexture, 960, () => {
      backReady = true
    })
    const choosePosition = (s: number, preferredPosition: Point | null = position) => {
      let best = null,
        bestScore = Infinity
      const candidates = []
      if (preferredPosition) candidates.push({ ...preferredPosition })
      const leftFirst = seed % 2 === 0
      const side = P.avoidCenter ? (leftFirst ? 0.14 : 0.86) : 0.5
      const xs = !P.avoidCenter
        ? [0.5, 0.62, 0.38, 0.7, 0.28]
        : leftFirst
          ? [0.14, 0.86, 0.22, 0.78, 0.3, 0.7, 0.5]
          : [0.86, 0.14, 0.78, 0.22, 0.7, 0.3, 0.5]
      for (const fy of [0.48, 0.38, 0.58, 0.28])
        for (const fx of xs) candidates.push({ x: W * fx, y: (H - TASKBAR) * fy })
      const preferred = preferredPosition || { x: W * side, y: (H - TASKBAR) * 0.48 }
      for (const candidate of candidates) {
        if (
          candidate.x - 96 * s < 12 ||
          candidate.x + 612 * s > W - 12 ||
          candidate.y - 116 * s < 12 ||
          candidate.y + 610 * s > H - TASKBAR - 12
        )
          continue
        let score = Math.hypot(candidate.x - preferred.x, candidate.y - preferred.y) * 0.01
        if (!preferredPosition && P.avoidCenter) {
          for (const region of regions) {
            const dx = Math.max(region.x - candidate.x, 0, candidate.x - region.x - region.w)
            const dy = Math.max(region.y - candidate.y, 0, candidate.y - region.y - region.h)
            score += Math.max(0, P.sigma + 20 - Math.hypot(dx, dy)) * 0.1
          }
        }
        if (score < bestScore) {
          best = candidate
          bestScore = score
        }
      }
      return best || { x: W * 0.48, y: (H - TASKBAR) * 0.4 }
    }
    return {
      moveTo(x: number, y: number) {
        pendingMove = { x, y }
      },
      draw(now: number, visible = true): Boy | null {
        if (ready < 2) return null
        const dt =
          previousTime === null ? 0 : Math.min(0.05, Math.max(0, (now - previousTime) / 1000))
        previousTime = now
        time += dt
        const s = Math.max(0.24, Math.min(1.25, W / 1379, (H - TASKBAR) / 1141)) * 0.35
        // 只在画面尺寸变化时重新定位，不跟踪图标。
        const next = [W, H, TASKBAR].join(',')
        if (signature !== next) {
          const hadLayout = !!signature
          signature = next
          home = choosePosition(s, null)
          homeAvoidCenter = P.avoidCenter
          target = choosePosition(s)
          if (
            hadLayout &&
            position &&
            returnAt === null &&
            Math.hypot(position.x - target.x, position.y - target.y) > 2
          ) {
            position = meadowResizeEntry(position, target, W, H - TASKBAR, s)
            trip = startTrip(position, target, s, { enter: true, click: true })
            kitePosition = null
          }
          nextRunAt = time + 7
        } else if (homeAvoidCenter !== P.avoidCenter) {
          // 设置切换时保留当前位置，下一次自动进场使用更新后的默认位置。
          home = choosePosition(s, null)
          homeAvoidCenter = P.avoidCenter
        }
        if (returnAt !== null) {
          if (time < returnAt) return null
          // 在整个画面之外换到下方，重新跑入时人物、牵线和风筝一起连续出现。
          const destination = home || choosePosition(s, null)
          const y = H + 116 * s + 24
          position = { x: destination.x + (y - destination.y) * 0.65, y }
          target = { ...destination }
          trip = startTrip(position, destination, s, { enter: true })
          kitePosition = null
          returnAt = null
          pullStarted = -Infinity
          lastLinePull = 0
          for (const key of Object.keys(kiteReaction) as (keyof typeof kiteReaction)[])
            kiteReaction[key] = 0
        }
        if (!target) target = choosePosition(s)
        if (!position) position = { ...target }
        // 进场期间保留最后一次点击；其他跑动可随时转向新的目标。
        if (pendingMove && !trip?.enter) {
          const destination = meadowClickTarget(pendingMove, W, H - TASKBAR, s)
          pendingMove = null
          if (Math.hypot(destination.x - position.x, destination.y - position.y) > 2) {
            target = destination
            trip = startTrip(position, destination, s, { click: true })
            pullStarted = -Infinity
          }
        }
        if (!trip) {
          const move = 1 - Math.exp(-dt * 0.7)
          position.x += (target.x - position.x) * move
          position.y += (target.y - position.y) * move
          if (time >= nextRunAt && Math.hypot(position.x - target.x, position.y - target.y) < 2) {
            const destination = meadowBoyRunDestination(position, s, W, H, TASKBAR)
            trip = startTrip(position, destination, s, { exit: destination.exit })
            pullStarted = -Infinity
          }
        }
        const activity = trip
          ? meadowBoyTripPose(time - trip.start, trip.cycles, trip.duration, trip)
          : meadowBoyTripPose(6)
        const facing = trip?.click ? meadowMoveFacing(trip.from, trip.to) : null
        if (facing && !facing.back) activity.back = false
        const turningTime = trip ? time - trip.start : 0
        const mirror = trip?.front
          ? !!facing?.mirror
          : trip
            ? !!(
                facing?.mirror &&
                turningTime >= meadowBoyTurnDuration / 2 &&
                turningTime <
                  (trip.duration || meadowBoyRunDuration) + meadowBoyTurnDuration * 1.5 + 0.18
              )
            : standingMirror
        if (facing && trip && !trip.front && !activity.running && !activity.done) {
          const phase =
            turningTime < meadowBoyTurnDuration
              ? turningTime / meadowBoyTurnDuration
              : (turningTime -
                  (trip.duration || meadowBoyRunDuration) -
                  meadowBoyTurnDuration -
                  0.18) /
                meadowBoyTurnDuration
          if (phase >= 0 && phase <= 1) activity.squeeze = 1 - 0.8 * Math.sin(phase * Math.PI)
        }
        if (trip) {
          position.x = trip.from.x + (trip.to.x - trip.from.x) * activity.progress
          position.y = trip.from.y + (trip.to.y - trip.from.y) * activity.progress
          if (activity.done) {
            if (trip.exit) {
              trip = null
              returnAt = time + 6
              return null
            }
            target = trip.after || { ...position }
            standingMirror = trip.front ? !!facing?.mirror : false
            trip = null
            nextRunAt = time + 18
            nextPullAt = Math.max(nextPullAt, time + 2.2)
          }
        }
        const waveTime = time % 9
        if (
          !trip &&
          !activity.back &&
          time >= nextPullAt &&
          nextRunAt - time > 3.6 &&
          (waveTime < 2.8 || waveTime > 5)
        ) {
          pullStarted = time
          nextPullAt = time + 7.8
        }
        const tug = meadowBoyTugPose(time - pullStarted)
        // 快速挥动持线手和专门拉线共用反馈，避免手先动、等下一次拉线才带动风筝。
        const linePull = activity.back ? 0 : Math.max(tug.pull, meadowBoyWavePull(time, tug))
        meadowBoyKiteReaction(kiteReaction, dt, Math.max(0, linePull - lastLinePull))
        lastLinePull = linePull
        // 跑动时平滑加强横向摆幅，起跑、停步后逐渐恢复平时的轻摆。
        const runWind = activity.running ? Math.sin(Math.PI * activity.progress) : 0
        const gust = (Math.sin(time * 4.8) * 60 + Math.sin(time * 7.1) * 8) * runWind
        const baseKx = 215 + Math.sin(time * 0.72) * 21 + Math.sin(time * 1.23) * 5 + gust,
          baseKy = 205 + Math.sin(time * 0.49 + 0.6) * 10
        const desiredKite = { x: position.x + baseKx * s, y: position.y + baseKy * s }
        if (!kitePosition || lastScale !== s) kitePosition = { ...desiredKite }
        lastScale = s
        const follow = 1 - Math.exp(-dt / 0.23)
        kitePosition.x += (desiredKite.x - kitePosition.x) * follow
        kitePosition.y += (desiredKite.y - kitePosition.y) * follow
        // 拉紧的位移同帧传到风筝，绕开跟随位置的缓动；松手后保留弹性摆动。
        const kx =
          baseKx +
          Math.max(-30, Math.min(32, (kitePosition.x - desiredKite.x) / s)) +
          kiteReaction.x -
          linePull * 10
        const ky =
          baseKy +
          Math.max(-30, Math.min(32, (kitePosition.y - desiredKite.y) / s)) +
          kiteReaction.y -
          linePull * 12
        const kiteRock = kiteReaction.angle + linePull * 0.1
        const pose = meadowBoyPose(time, tug)
        if (facing && !facing.back && activity.running) {
          pose.body[1] += activity.bob
        }
        const runFrame =
          activity.running && (activity.back ? backReady : frontReady)
            ? meadowRunFrame((activity.phase || 0) * runFrameSpeed)
            : -1
        const ground = meadowBoyGroundPose(activity, pose, runFrame)
        if (runFrame >= 0) {
          // 新素材的头部与线轮已逐帧对齐，绳端固定在线轮上。
          pose.hand = activity.back
            ? [46 * activity.squeeze, -52 + activity.bob]
            : [-36 * activity.squeeze, -49 + activity.bob]
          pose.reelHand = [...pose.hand]
        } else if (activity.back) {
          // 斜背面各帧的握线手位置，连线随转身和跑步动作一起移动。
          const grip: Vec2 = (
            [
              [44, -23],
              [37, -23],
              [49, -25],
              [37, -23],
            ] as Vec2[]
          )[activity.frame]!
          pose.hand = [grip[0] * activity.squeeze, grip[1] - 10 + activity.bob]
          pose.reelHand = [...pose.hand]
        } else {
          pose.hand[0] *= activity.squeeze
          pose.reelHand[0] *= activity.squeeze
        }
        if (mirror) {
          pose.hand[0] *= -1
          ground.line[0] *= -1
          for (const contact of ground.contacts) contact[0] *= -1
        }
        const state = {
          time,
          position: { ...position },
          home: { ...(home || target) },
          layout: signature,
          routeTarget: trip ? trip.to : target,
          kite: { x: position.x + kx * s, y: position.y + ky * s },
          ...activity,
          wind: runWind,
          ground,
          tug,
          linePull,
          kiteReaction: { ...kiteReaction },
        }
        if (!visible) return { state }
        const k = resolution.scale,
          left = Math.floor((position.x - 96 * s) * k) - 1,
          top = Math.floor((position.y - 116 * s) * k) - 1
        const width = Math.ceil(708 * s * k) + 2,
          height = Math.ceil(726 * s * k) + 2
        if (width !== targetWidth || height !== targetHeight) {
          targetWidth = width
          targetHeight = height
          gl.activeTexture(gl.TEXTURE6)
          for (const layer of layers) {
            gl.bindTexture(gl.TEXTURE_2D, layer)
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.RGBA,
              width,
              height,
              0,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              null,
            )
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
          }
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.viewport(0, 0, width, height)
        gl.useProgram(shader.p)
        gl.activeTexture(gl.TEXTURE4)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.activeTexture(gl.TEXTURE7)
        gl.bindTexture(gl.TEXTURE_2D, runTexture)
        gl.activeTexture(gl.TEXTURE10)
        gl.bindTexture(gl.TEXTURE_2D, frontFramesTexture)
        gl.uniform1i(shader.U.uFrontRunSprite!, 10)
        gl.activeTexture(gl.TEXTURE11)
        gl.bindTexture(gl.TEXTURE_2D, backFramesTexture)
        gl.uniform1i(shader.U.uBackRunSprite!, 11)
        gl.uniform1f(shader.U.uRunFrame!, runFrame)
        gl.uniform1i(shader.U.uRunSprite!, 7)
        gl.uniform1i(shader.U.uCharacter!, 4)
        gl.uniform2f(shader.U.uRes!, width / k, height / k)
        gl.uniform2f(shader.U.uOffset!, left / k, top / k)
        gl.uniform3f(shader.U.uPlace!, position.x, position.y, s)
        gl.uniform2f(shader.U.uKite!, kx, ky)
        gl.uniform4f(shader.U.uPose!, pose.head, pose.nod, pose.reel, pose.pull)
        gl.uniform4f(
          shader.U.uMotion!,
          activity.frame,
          activity.back ? 1 : 0,
          activity.squeeze,
          activity.bob,
        )
        gl.uniform2f(shader.U.uGround!, ...ground.line)
        gl.uniform3f(shader.U.uContactL!, ...ground.contacts[0]!)
        gl.uniform3f(shader.U.uContactR!, ...ground.contacts[1]!)
        gl.uniform2f(shader.U.uBody!, ...pose.body)
        gl.uniform2f(shader.U.uLegs!, ...pose.legs)
        gl.uniform2f(shader.U.uHand!, ...pose.hand)
        gl.uniform2f(shader.U.uTug!, ...pose.tugOffset)
        gl.uniform1f(shader.U.uTension!, linePull)
        gl.uniform1f(shader.U.uKiteRock!, kiteRock)
        gl.uniform1f(shader.U.uFacing!, mirror ? -1 : 1)
        gl.uniform2f(shader.U.uReelHand!, ...pose.reelHand)
        gl.uniform1f(shader.U.uLook!, pose.look)
        gl.uniform1f(shader.U.uScale!, k)
        gl.uniform1f(shader.U.uTime!, time)
        gl.uniform1f(shader.U.uRunWind!, runWind)
        const regions: [Vec4[], Vec4[]] = [
          [
            [-70, 25, 185, 230],
            [105, 140, 612, 610],
          ],
          [
            [-90, -110, 116, 90],
            [12, -35, 205, 260],
            [12, 65, 514, 476],
          ],
        ]
        try {
          for (let i = 0; i < 2; i++) {
            gl.framebufferTexture2D(
              gl.FRAMEBUFFER,
              gl.COLOR_ATTACHMENT0,
              gl.TEXTURE_2D,
              layers[i]!,
              0,
            )
            gl.disable(gl.SCISSOR_TEST)
            gl.clearColor(0, 0, 0, 0)
            gl.clear(gl.COLOR_BUFFER_BIT)
            gl.uniform1f(shader.U.uShadow!, i === 0 ? 1 : 0)
            gl.enable(gl.SCISSOR_TEST)
            // 空白处不执行人物着色器；重叠小块直接覆盖同一结果，不会叠深。
            for (const [x0, y0, x1, y1] of regions[i]!) {
              const l = Math.max(0, Math.floor((position.x + x0 * s) * k) - left - 2)
              const r = Math.min(width, Math.ceil((position.x + x1 * s) * k) - left + 2)
              const t = Math.max(0, Math.floor((position.y + y0 * s) * k) - top - 2)
              const b = Math.min(height, Math.ceil((position.y + y1 * s) * k) - top + 2)
              gl.scissor(l, height - b, Math.max(0, r - l), Math.max(0, b - t))
              gl.drawArrays(gl.TRIANGLES, 0, 3)
            }
          }
        } finally {
          gl.disable(gl.SCISSOR_TEST)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          gl.viewport(0, 0, cv.width, cv.height)
        }
        return {
          rect: [left / k, top / k, width / k, height / k],
          shadow: layers[0],
          actor: layers[1],
          state,
        }
      },
    }
  }

  // 每次打开场景随机选择两只猫，贴图只上传一次，并优先避开男孩的路线。
  let meadowCatScene: ReturnType<typeof createMeadowCatScene> | null = null
  const meadowCatSegmentDistance = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x,
      dy = b.y - a.y
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
    )
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t)
  }

  const meadowCatRunLanes = (state: BoyState, width: number, height: number, taskbar: number) => {
    const scale = Math.max(0.24, Math.min(1.25, width / 1379, (height - taskbar) / 1141)) * 0.35
    const lanes: [Point, Point][] = []
    const add = (a: Point, b: Point) => {
      lanes.push([{ ...a }, { ...b }])
      return b
    }
    const finish = (from: Point) => {
      for (let i = 0; i < 64; i++) {
        const to = meadowBoyRunDestination(from, scale, width, height, taskbar)
        add(from, to)
        from = to
        if (to.exit) break
      }
    }
    // 包含正在进行的那一段，以及之后一直跑出上边缘的各段。
    const current = state.routeTarget ? add(state.position, state.routeTarget) : state.position
    finish(current)
    // 下方返回后每轮走同一条路线，预留整轮，而非只避开男孩当前的位置。
    const bottom = {
      y: height + 116 * scale + 24,
      x: state.home.x + (height + 116 * scale + 24 - state.home.y) * 0.65,
    }
    add(bottom, state.home)
    finish(state.home)
    return { lanes, scale }
  }

  const meadowCatChoosePlace = (
    state: BoyState,
    width: number,
    height: number,
    taskbar: number,
    sceneSeed: number,
    regions: MeadowRegion[],
    cloudSize: number,
    other: { x: number; y: number; size: number } | null,
  ) => {
    const { lanes, scale } = meadowCatRunLanes(state, width, height, taskbar)
    const size =
      Math.max(28, Math.min(90, Math.min(width / 1379, (height - taskbar) / 1141) * 78)) * 0.578
    const radius = size * 0.58,
      pad = radius + 12,
      clearance = radius + 96 * scale + 14
    if (width <= pad * 2 || height - taskbar <= pad * 2) return null
    let randomState = (sceneSeed | 0) ^ 0x71a43d25
    const random = () => {
      randomState = (randomState + 0x6d2b79f5) | 0
      let v = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState)
      v ^= v + Math.imul(v ^ (v >>> 7), 61 | v)
      return ((v ^ (v >>> 14)) >>> 0) / 4294967296
    }
    let best = null,
      bestScore = Infinity
    for (let i = 0; i < 337; i++) {
      const x = i < 256 ? random() : (((i - 256) % 9) + 0.5) / 9
      const y = i < 256 ? random() : (Math.floor((i - 256) / 9) + 0.5) / 9
      const p = { x: pad + x * (width - pad * 2), y: pad + y * (height - taskbar - pad * 2) }
      const separation = (size + (other?.size || 0)) / 2 + 8
      if (other && Math.abs(p.x - other.x) < separation && Math.abs(p.y - other.y) < separation)
        continue
      const routeDistance = Math.min(...lanes.map(([a, b]) => meadowCatSegmentDistance(p, a, b)))
      let score = Math.max(0, clearance - routeDistance) * 4
      for (const icon of regions) {
        const dx = Math.max(icon.x - p.x, 0, p.x - icon.x - icon.w)
        const dy = Math.max(icon.y - p.y, 0, p.y - icon.y - icon.h)
        score += Math.max(0, radius + cloudSize + 25 - Math.hypot(dx, dy))
      }
      if (score < bestScore) {
        best = { ...p, size }
        bestScore = score
      }
      if (score === 0) break
    }
    return best
  }

  const meadowCatTailAngle = (time: number, sceneSeed: number) => {
    const period = 10 + Math.abs(sceneSeed % 4),
      age = ((time + Math.abs(sceneSeed % 1300) / 1000) % period) - 3
    if (age < 0 || age >= 1.6) return 0
    const t = age / 1.6
    // 大部分时间安静躺着，偶尔柔和地来回摆两下，起止都回到原姿势。
    return Math.sin(t * Math.PI * 4) * Math.pow(Math.sin(t * Math.PI), 2) * 0.34
  }

  const prepareMeadowCat = (boy: Boy | null, now = 0) => {
    if (!meadowCatScene) meadowCatScene = createMeadowCatScene()
    return meadowCatScene.prepare(boy, now)
  }

  const createMeadowCatScene = () => {
    const cats = chooseMeadowCats().map((index) => ({
      texture: gl.createTexture(),
      source: assets.cats[index]!,
      ready: false,
    }))
    let layout = '',
      signature = '',
      routeState: BoyState | null = null,
      places: ReturnType<typeof meadowCatChoosePlace>[] = []
    let time = 0,
      previousTime: number | null = null
    for (const cat of cats) {
      const image = new Image()
      pendingImages.add(image)
      image.onload = () => {
        pendingImages.delete(image)
        if (isDisposed()) return
        const sprite = document.createElement('canvas')
        sprite.width = sprite.height = 384
        sprite.getContext('2d')!.drawImage(image, 0, 0, 384, 384)
        gl.activeTexture(gl.TEXTURE8)
        gl.bindTexture(gl.TEXTURE_2D, cat.texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sprite)
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        cat.ready = true
      }
      image.onerror = () => {
        pendingImages.delete(image)
        if (!isDisposed()) console.warn('草地小猫素材加载失败')
      }
      image.src = cat.source
    }
    return {
      prepare(boy: Boy | null, now: number) {
        if (previousTime !== null) time += Math.max(0, Math.min(0.05, (now - previousTime) / 1000))
        previousTime = now
        const nextLayout = [W, H, TASKBAR].join(',')
        if (layout !== nextLayout) {
          layout = nextLayout
          routeState = null
          places = []
          signature = ''
        }
        if (boy && boy.state.layout === layout) routeState = boy.state
        if (!routeState) return []
        const next = [layout, seed].join(',')
        if (next !== signature) {
          signature = next
          const first = meadowCatChoosePlace(
            routeState,
            W,
            H,
            TASKBAR,
            seed,
            regions,
            P.sigma,
            null,
          )
          const second = meadowCatChoosePlace(
            routeState,
            W,
            H,
            TASKBAR,
            seed + 7919,
            regions,
            P.sigma,
            first,
          )
          places = [first, second]
        }
        return cats.flatMap((cat, index) => {
          const place = places[index]
          if (!cat.ready || !place) return []
          const size = place.size,
            rect: Vec4 = [place.x - size / 2, place.y - size / 2, size, size],
            shadow: Vec2 = [size * 0.045, size * 0.06]
          return [
            {
              texture: cat.texture,
              rect,
              shadow,
              tail: meadowCatTailAngle(time, seed + index * 1301),
              bounds: [
                rect[0] - 2,
                rect[1] - 2,
                size + shadow[0] + 4,
                size + shadow[1] + 4,
              ] as Vec4,
            },
          ]
        })
      },
    }
  }

  return {
    moveBoy(x: number, y: number) {
      syncScene()
      if (!meadowBoyScene) meadowBoyScene = createMeadowBoyScene()
      meadowBoyScene.moveTo(x, y)
    },
    prepareBoy(now: number, visible: boolean) {
      syncScene()
      return prepareMeadowBoy(now, visible)
    },
    prepareCat(boy: Boy | null, now: number) {
      syncScene()
      return prepareMeadowCat(boy, now)
    },
  }
}
