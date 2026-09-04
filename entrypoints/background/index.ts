import { defineBackground } from '#imports'

import { initializeBookmarkCache } from './bookmarkCache'

export default defineBackground(() => {
  initializeBookmarkCache()
})
