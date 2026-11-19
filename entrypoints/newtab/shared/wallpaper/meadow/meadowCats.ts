/** 随机排列猫的素材，场景增加猫时继续使用同一顺序。 */
export function chooseMeadowCats(assets: readonly string[], random = Math.random) {
  const order = [...assets]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const selected = order[j]!
    order[j] = order[i]!
    order[i] = selected
  }
  return order
}
