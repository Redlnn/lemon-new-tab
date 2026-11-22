type WakeSpeck = { side: number; jitter: number; size: number }
type WakePoint = {
  x: number
  y: number
  time: number
  normalX: number
  normalY: number
  specks: WakeSpeck[]
}
type WhalePose = {
  bodyHeading: number
  tailHeading: number
  turnRate: number
  headSlope: number
  tailSlope: number
  tailPitch: number
}
type OceanSubject = {
  kind: number
  index: number
  x: number
  y: number
  heading: number
  boom: number
  whale: WhalePose | null
  side: number
  phase: number
  initialized: boolean
  trail: WakePoint[]
}

// Clouds in the meadow compositor travel from left to right.
const WIND = 0
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
const follow = (dt: number, seconds: number) => -Math.expm1(-dt / seconds)
const turnSlope = (angle: number) => Math.tan(Math.max(-0.46, Math.min(0.46, wrapAngle(angle))))

function createWakePoint(subject: OceanSubject, time: number): WakePoint {
  const yacht = subject.kind === 1
  const stern = yacht ? 29 : 23
  const sin = Math.sin(subject.heading),
    cos = Math.cos(subject.heading)
  const seed = time * 31.7 + subject.phase * 13.1
  const random = (n: number) => {
    const value = Math.sin(seed + n * 19.3) * 43758.5453
    return value - Math.floor(value)
  }
  const sizes = [0, 1, 2].map((i) => 2.5 + random(i + 4) * 2.5)
  const specks: WakeSpeck[] = []
  for (const side of [-1, 1]) {
    for (let i = 0; i < sizes.length; i++)
      specks.push({ side, jitter: random(i + side * 5) - 0.5, size: sizes[i]! })
  }
  // Motor yachts also leave a lighter stream of propeller bubbles.
  if (yacht) {
    for (let i = 0; i < 2; i++)
      specks.push({ side: 0, jitter: random(i + 17) - 0.5, size: 2 + random(i + 21) * 2 })
  }
  return {
    x: subject.x - cos * stern,
    y: subject.y - sin * stern,
    time,
    normalX: -sin,
    normalY: cos,
    specks,
  }
}

export function createOceanMotion() {
  const subjects: OceanSubject[] = []
  const activeSubjects: OceanSubject[] = []
  const reserved = [0, 0, 0, 0]

  function step(
    time: number,
    dt: number,
    width: number,
    height: number,
    active: number[],
    clearance: (x: number, y: number) => number,
  ) {
    for (let kind = 0; kind < active.length; kind++) {
      while (reserved[kind]! < active[kind]!) {
        const index = reserved[kind]!++
        subjects.push({
          kind,
          index,
          x: -1,
          y: -1,
          heading: 0.5 + index,
          boom: 0,
          whale: null,
          side: 1,
          phase: index * 2.7 + kind * 1.9,
          initialized: false,
          trail: [],
        })
      }
    }
    activeSubjects.length = 0
    for (const subject of subjects) {
      if (subject.index >= active[subject.kind]!) {
        subject.initialized = false
        subject.trail.length = 0
        continue
      }
      if (!subject.initialized) {
        let best = -Infinity
        for (let i = 0; i < (subject.kind < 2 ? 40 : 1); i++) {
          const x = width * (0.12 + Math.random() * 0.76)
          const y = height * (0.12 + Math.random() * 0.76)
          let score = subject.kind < 2 ? clearance(x, y) : 0
          for (const other of subjects)
            if (other !== subject && other.kind < 2 && other.initialized)
              score = Math.min(score, Math.hypot(x - other.x, y - other.y) - 100)
          if (score > best) {
            best = score
            subject.x = x
            subject.y = y
          }
        }
        subject.trail.length = 0
        if (subject.kind === 2) {
          subject.whale = {
            bodyHeading: subject.heading,
            tailHeading: subject.heading,
            turnRate: 0,
            headSlope: 0,
            tailSlope: 0,
            tailPitch: 1,
          }
        }
        subject.initialized = true
      }
      const margin = Math.min(100, width * 0.18, height * 0.18)
      const aheadX = subject.x + Math.cos(subject.heading) * margin
      const aheadY = subject.y + Math.sin(subject.heading) * margin
      let turn = Math.sin(time * 0.09 + subject.phase) * 0.06
      if (
        aheadX < margin ||
        aheadX > width - margin ||
        aheadY < margin ||
        aheadY > height - margin
      ) {
        const target = Math.atan2(height / 2 - subject.y, width / 2 - subject.x)
        turn = Math.max(-0.35, Math.min(0.35, wrapAngle(target - subject.heading)))
      } else if (
        subject.kind < 2 &&
        clearance(subject.x, subject.y) > 0 &&
        clearance(aheadX, aheadY) < 55
      ) {
        const left = subject.heading - 0.8,
          right = subject.heading + 0.8
        const leftFree = clearance(
          subject.x + Math.cos(left) * margin,
          subject.y + Math.sin(left) * margin,
        )
        const rightFree = clearance(
          subject.x + Math.cos(right) * margin,
          subject.y + Math.sin(right) * margin,
        )
        turn = leftFree > rightFree ? -0.3 : 0.3
      }
      const whale = subject.whale
      if (whale) {
        whale.turnRate += (turn - whale.turnRate) * follow(dt, 0.42)
        turn = whale.turnRate
      }
      subject.heading += turn * dt
      if (whale) {
        // The swimming direction leads the body, and the body leads the flukes.
        whale.bodyHeading += wrapAngle(subject.heading - whale.bodyHeading) * follow(dt, 0.55)
        whale.tailHeading += wrapAngle(whale.bodyHeading - whale.tailHeading) * follow(dt, 1.35)
        whale.headSlope = turnSlope(subject.heading - whale.bodyHeading)
        whale.tailSlope = turnSlope(whale.tailHeading - whale.bodyHeading)
        whale.tailPitch = 0.76 + 0.24 * Math.cos(time * 1.3 + subject.phase)
      }
      const speed = subject.kind === 0 ? 10 : subject.kind === 1 ? 16 : subject.kind === 2 ? 5 : 35
      subject.x += Math.cos(subject.heading) * speed * dt
      subject.y += Math.sin(subject.heading) * speed * dt
      if (subject.kind === 0) {
        const relativeWind = wrapAngle(WIND - subject.heading)
        if (Math.abs(Math.sin(relativeWind)) > 0.05)
          // The boom vector points towards the stern, so its signed rotation
          // has the opposite sign to the wind's lateral component.
          subject.side = -Math.sign(Math.sin(relativeWind))
        const target = subject.side * (0.18 + (0.9 * (1 + Math.cos(relativeWind))) / 2)
        subject.boom += Math.max(-dt * 0.5, Math.min(dt * 0.5, target - subject.boom))
      }
      if (subject.kind < 2) {
        const last = subject.trail.at(-1)
        if (!last || time - last.time >= 0.16) subject.trail.push(createWakePoint(subject, time))
        while (
          subject.trail.length &&
          (subject.trail.length > 60 || time - subject.trail[0]!.time > 8)
        )
          subject.trail.shift()
      }
      activeSubjects.push(subject)
    }
    return activeSubjects
  }
  return { step }
}

export type OceanWakeSubject = ReturnType<ReturnType<typeof createOceanMotion>['step']>[number]
