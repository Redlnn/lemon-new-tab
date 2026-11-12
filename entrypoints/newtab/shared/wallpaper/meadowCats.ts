/** 从四只不同的猫中等概率抽取两只，不放回。 */
export function chooseMeadowCats(random: () => number = Math.random): [number, number] {
  const first = Math.floor(random() * 4)
  const second = Math.floor(random() * 3)
  return [first, second >= first ? second + 1 : second]
}
