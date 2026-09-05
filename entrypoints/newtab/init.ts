function renderStartupError(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const fallback = document.getElementById('startup-fallback')
  const detail = fallback?.querySelector('pre')
  if (detail)
    detail.textContent = `Lemon New Tab startup failed.\n${message}\nSee console for details.`
  fallback?.removeAttribute('hidden')
}

async function bootstrapNewtab() {
  const syncStartupTask = import('@/shared/webdavSync/bridge').then(
    async ({ prepareSyncBeforeNewTabStartup, setupOnlineSyncTrigger }) => {
      await prepareSyncBeforeNewTabStartup()
      setupOnlineSyncTrigger()
    },
  )
  const [{ initI18n }, { shouldStartApp }] = await Promise.all([
    import('@/shared/i18n'),
    import('@/shared/settings/bootstrap'),
  ])
  const [, canStartApp] = await Promise.all([initI18n(), shouldStartApp(), syncStartupTask])
  if (!canStartApp) {
    return
  }

  const dayjsTask = import('./shared/dayjs').then(({ initDayjs }) => initDayjs())
  const mainModuleTask = import('./main')
  const [, { main }] = await Promise.all([dayjsTask, mainModuleTask])
  await main()
}

void (async () => {
  document.getElementById('startup-fallback')?.setAttribute('hidden', '')
  try {
    await bootstrapNewtab()
  } catch (error) {
    console.error('[newtab] startup failed', error)
    renderStartupError(error)
  }
})()
