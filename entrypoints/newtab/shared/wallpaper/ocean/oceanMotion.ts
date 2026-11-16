type WakePoint = { x: number; y: number; heading: number; time: number }
type OceanSubject = {
  kind: number
  index: number
  x: number
  y: number
  heading: number
  boom: number
  bend: number
  tailHeading: number
  side: number
  phase: number
  initialized: boolean
  trail: WakePoint[]
}

// Clouds in the meadow compositor travel from left to right.
const WIND = 0
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))

export function createOceanMotion() {
  const subjects: OceanSubject[] = []
  const activeSubjects: OceanSubject[] = []
  const counts = [3, 3, 2, 8]
  for (let kind = 0; kind < counts.length; kind++)
    for (let index = 0; index < counts[kind]!; index++)
      subjects.push({
        kind,
        index,
        x: -1,
        y: -1,
        heading: 0.5 + index,
        boom: 0,
        bend: 0,
        tailHeading: 0.5 + index,
        side: 1,
        phase: index * 2.7 + kind * 1.9,
        initialized: false,
        trail: [],
      })

  function step(
    time: number,
    dt: number,
    width: number,
    height: number,
    active: number[],
    clearance: (x: number, y: number) => number,
  ) {
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
        subject.tailHeading = subject.heading
        subject.bend = 0
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
      subject.heading += turn * dt
      if (subject.kind === 2) {
        // The tail follows the body's actual heading with inertia; there is
        // no independent lateral swimming oscillation.
        const lag = wrapAngle(subject.heading - subject.tailHeading)
        subject.tailHeading += lag * Math.min(1, dt * 1.4)
        subject.bend = Math.max(
          -18,
          Math.min(18, wrapAngle(subject.heading - subject.tailHeading) * 75),
        )
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
        if (!last || time - last.time >= 0.16) {
          const stern = subject.kind === 0 ? 23 : 29
          subject.trail.push({
            x: subject.x - Math.cos(subject.heading) * stern,
            y: subject.y - Math.sin(subject.heading) * stern,
            heading: subject.heading,
            time,
          })
        }
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
