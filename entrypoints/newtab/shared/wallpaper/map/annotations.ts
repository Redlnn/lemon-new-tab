import type { MapData } from './model'

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
const ink = '#654323'
export function paintCompass(ctx: Context, x: number, y: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineWidth = 0.9 * 1.25
  for (let i = 0; i < 32; i++) {
    const start = (i * Math.PI) / 16 - Math.PI / 2,
      end = ((i + 1) * Math.PI) / 16 - Math.PI / 2
    ctx.beginPath()
    ctx.arc(0, 0, 32, start, end)
    ctx.arc(0, 0, 29, end, start, true)
    ctx.closePath()
    ctx.fillStyle = i % 2 ? '#efdcae' : ink
    ctx.fill()
  }
  ctx.fillStyle = ink
  ctx.beginPath()
  ctx.arc(0, 0, 32, 0, Math.PI * 2)
  ctx.moveTo(29, 0)
  ctx.arc(0, 0, 29, 0, Math.PI * 2)
  ctx.stroke()
  for (let i = 0; i < 8; i++) {
    ctx.save()
    ctx.rotate((i * Math.PI) / 4)
    const r = i % 2 ? 19 : 31
    ctx.beginPath()
    ctx.moveTo(0, -r)
    ctx.lineTo(4, 0)
    ctx.lineTo(0, 5)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(0, -r)
    ctx.lineTo(-4, 0)
    ctx.lineTo(0, 5)
    ctx.closePath()
    ctx.stroke()
    ctx.restore()
  }
  ctx.font = 'italic 13px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText('N', 0, -39)
  ctx.fillText('S', 0, 48)
  ctx.fillText('W', -43, 4)
  ctx.fillText('E', 43, 4)
  ctx.restore()
}
export function paintLabel(ctx: Context, label: MapData['labels'][number]) {
  ctx.font = `italic ${label.size}px Georgia, "Times New Roman", serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ink
  ctx.strokeStyle = 'rgba(239,220,174,0.8)'
  ctx.lineWidth = 3 * 1.25
  ctx.strokeText(label.text, label.x, label.y)
  ctx.fillText(label.text, label.x, label.y)
}
