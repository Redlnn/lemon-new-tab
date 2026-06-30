type Opts = { transparent: boolean; transparency?: number; blur: boolean }

/**
 * 生成受性能开关控制的类名字符串。
 * 规则：
 * - 始终包含前缀类：`${prefix}`
 * - 启用透明且透明度大于 0 => 添加 `${prefix}--opacity`
 * - 启用模糊 且 (启用透明 或 options.blurIndependent 为 true) => 添加 `${prefix}--blur`
 */
export function getPerfClasses(
  opts: Opts,
  prefix: string,
  options?: { blurIndependent?: boolean; withoutPrefix?: boolean },
): string {
  const transparentOn =
    opts.transparent && (opts.transparency === undefined || opts.transparency > 0)
  const blurOn = opts.blur && (transparentOn || options?.blurIndependent === true)

  if (!transparentOn && !blurOn) {
    return options?.withoutPrefix ? '' : prefix
  }

  const base = options?.withoutPrefix ? '' : prefix
  const opacity = transparentOn ? `${prefix}--opacity` : ''
  const blur = blurOn ? `${prefix}--blur` : ''

  // 根据实际情况拼接，避免数组操作
  if (base) {
    if (opacity && blur) return `${base} ${opacity} ${blur}`
    if (opacity) return `${base} ${opacity}`
    return `${base} ${blur}`
  }
  if (opacity && blur) return `${opacity} ${blur}`
  return opacity || blur
}

/**
 * 小工具：根据动态 opts 生成 perf class 的便捷函数，避免在组件中重复计算相同 opts
 * 用法：
 * ```
 * const perf = usePerfClasses(() => ({ transparent: ..., transparency: ..., blur: ... }));
 * const cls = perf('prefix') // cls is a computed ref
 * ```
 */
export function usePerfClasses(getOpts: () => Opts) {
  return (prefix: string, options?: { blurIndependent?: boolean; withoutPrefix?: boolean }) =>
    computed(() => getPerfClasses(getOpts(), prefix, options))
}

export default usePerfClasses
