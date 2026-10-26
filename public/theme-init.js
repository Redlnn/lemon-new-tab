// @ts-check
;(function () {
  let mode
  try {
    mode = localStorage.getItem('vueuse-color-scheme')
  } catch {
    // 存储不可用时仍按系统主题显示。
  }
  const isDark =
    mode === 'dark' ||
    (mode !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const root = document.documentElement
  const theme = isDark ? 'dark' : 'light'
  root.classList.add(theme)
  // 在样式解析前确定画布颜色，避免 Firefox 先显示浏览器自身的底色。
  root.style.colorScheme = theme
  root.style.backgroundColor = isDark ? '#0a0a0a' : '#f2f3f5'
})()
