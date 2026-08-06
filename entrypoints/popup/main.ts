function renderPopupStartupError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  document.getElementById('app')?.replaceChildren()
  const fallbackMain = document.getElementById('fallback')
  if (fallbackMain) {
    fallbackMain.classList.remove('hidden')
    const pre = fallbackMain.querySelector('.fallback-pre')
    if (pre) {
      pre.textContent = message
    }
  }
}

void (async () => {
  document.getElementById('fallback')?.classList.add('hidden')
  try {
    const { bootstrapPopup } = await import('./bootstrap')
    await bootstrapPopup()
  } catch (error) {
    console.error('[popup] startup failed', error)
    renderPopupStartupError(error)
  }
})()
