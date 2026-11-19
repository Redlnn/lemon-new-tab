const MAX_SCHOOLS = 8
const MAX_MEMBERS = 62
const TRAIL_STEP = 0.12
const TRAIL_LENGTH = 72
const MAX_DELAY = 7.6
const TURN_OPTIONS = [0.55, -0.55, 1.1, -1.1, 1.75, -1.75, 2.4, -2.4, Math.PI]

type Fish = { delay: number; across: number; size: number; phase: number }
type School = {
  x: number
  y: number
  heading: number
  turn: number
  turnBias: number
  speed: number
  time: number
  sampleAge: number
  trailHead: number
  trail: Float32Array
  members: Fish[]
}

function createSchool(x: number, y: number, heading: number): School {
  const speed = 18 + Math.random() * 5
  const trail = new Float32Array(TRAIL_LENGTH * 3)
  for (let i = 0; i < TRAIL_LENGTH; i++) {
    const distance = i * TRAIL_STEP * speed
    const index = ((TRAIL_LENGTH - i) % TRAIL_LENGTH) * 3
    trail[index] = x - Math.cos(heading) * distance
    trail[index + 1] = y - Math.sin(heading) * distance
    trail[index + 2] = heading
  }

  const count = 40 + Math.floor(Math.random() * (MAX_MEMBERS - 39))
  const clumps = [1 + Math.random() * 1.3, 3 + Math.random(), 5 + Math.random() * 1.3]
  const members: Fish[] = []
  for (let i = 0; i < count; i++) {
    let delay = 0
    let across = 0
    for (let attempt = 0; attempt < 12; attempt++) {
      const jitter = (Math.random() + Math.random() - 1) * 1.65
      const center = clumps[Math.floor(Math.random() * clumps.length)]!
      delay = Math.max(0, Math.min(MAX_DELAY, center + jitter))
      if (Math.random() < 0.2) delay = Math.random() * MAX_DELAY
      const width = 9 + 21 * Math.sin((delay / MAX_DELAY) * Math.PI)
      across = (Math.random() + Math.random() - 1) * width
      if (
        members.every((fish) => Math.hypot((fish.delay - delay) * speed, fish.across - across) >= 5)
      )
        break
    }
    members.push({ delay, across, size: 0.61 + Math.random() * 0.27, phase: Math.random() * 6.28 })
  }
  return {
    x,
    y,
    heading,
    turn: 0,
    turnBias: Math.random() < 0.5 ? 1 : -1,
    speed,
    time: Math.random() * 40,
    sampleAge: 0,
    trailHead: 0,
    trail,
    members,
  }
}

export function createBeachFish() {
  const schools: School[] = []
  const data = new Float32Array(MAX_SCHOOLS * MAX_MEMBERS * 5)

  const update = (
    count: number,
    width: number,
    height: number,
    dt: number,
    depth: (x: number, y: number) => number,
  ) => {
    schools.length = Math.min(schools.length, count)
    if (!count) return 0
    const clearance = (x: number, y: number) =>
      Math.min(x - 12, width - x - 12, y - 12, height - y - 12, depth(x, y) - 12)
    for (let i = schools.length - 1; i >= 0; i--) {
      const { x, y } = schools[i]!
      if (clearance(x, y) < -12) schools.splice(i, 1)
    }
    for (let i = 0; i < 24 && schools.length < count; i++) {
      const x = Math.random() * width
      const y = Math.random() * height
      const heading = Math.random() * Math.PI * 2
      if (
        clearance(x, y) < 40 ||
        clearance(x - Math.cos(heading) * 95, y - Math.sin(heading) * 95) < 8 ||
        schools.some((school) => Math.hypot(school.x - x, school.y - y) < 110)
      )
        continue
      schools.push(createSchool(x, y, heading))
    }

    let offset = 0
    for (const school of schools) {
      const { x, y, heading } = school
      school.time += dt
      const ahead = (angle: number) => {
        const dx = Math.cos(angle) * 92
        const dy = Math.sin(angle) * 92
        return Math.min(clearance(x + dx, y + dy), clearance(x + dx * 0.5, y + dy * 0.5))
      }
      let turn = Math.sin(school.time * 0.36) * 0.22 + Math.sin(school.time * 0.13) * 0.11
      const forward = ahead(heading)
      if (forward < 38) {
        let score = forward
        for (const option of TURN_OPTIONS) {
          const candidate = option * school.turnBias
          const space = Math.min(70, ahead(heading + candidate)) - Math.abs(candidate) * 13
          if (space <= score) continue
          score = space
          turn = Math.max(-0.68, Math.min(0.68, candidate))
        }
      }
      school.turn += (turn - school.turn) * (1 - Math.exp(-dt * 3.8))
      school.heading += school.turn * dt
      const distance = school.speed * dt
      school.x += Math.cos((heading + school.heading) * 0.5) * distance
      school.y += Math.sin((heading + school.heading) * 0.5) * distance

      // Keep evenly timed samples so the rear of the school turns after the front.
      school.sampleAge += dt
      if (school.sampleAge >= TRAIL_STEP) {
        school.sampleAge -= TRAIL_STEP
        school.trailHead = (school.trailHead + 1) % TRAIL_LENGTH
        const index = school.trailHead * 3
        const t = 1 - school.sampleAge / dt
        school.trail[index] = x + (school.x - x) * t
        school.trail[index + 1] = y + (school.y - y) * t
        school.trail[index + 2] = heading + (school.heading - heading) * t
      }

      for (const fish of school.members) {
        const phase = school.time * (0.9 + fish.size * 0.25) + fish.phase
        const delay = Math.max(0, fish.delay + Math.sin(phase) * 0.11)
        const sample = Math.max(0, (delay - school.sampleAge) / TRAIL_STEP)
        const step = Math.floor(sample)
        const near = ((school.trailHead - step + TRAIL_LENGTH) % TRAIL_LENGTH) * 3
        const far = ((near / 3 - 1 + TRAIL_LENGTH) % TRAIL_LENGTH) * 3
        const t = sample - step
        const head = delay < school.sampleAge ? delay / school.sampleAge : 1
        const trail = school.trail
        const heading = trail[near + 2]! + (trail[far + 2]! - trail[near + 2]!) * t
        const direction = school.heading + (heading - school.heading) * head
        const side = fish.across + Math.cos(phase) * 1.7
        const px = trail[near]! + (trail[far]! - trail[near]!) * t
        const py = trail[near + 1]! + (trail[far + 1]! - trail[near + 1]!) * t
        data[offset++] = school.x + (px - school.x) * head - Math.sin(direction) * side
        data[offset++] = school.y + (py - school.y) * head + Math.cos(direction) * side
        data[offset++] = direction + Math.sin(phase) * 0.075
        data[offset++] = fish.size
        data[offset++] = fish.phase
      }
    }
    return offset / 5
  }
  return { data, update }
}
