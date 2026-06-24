import type { ComputedRef, InjectionKey } from 'vue'

export interface BookmarkItemContext {
  popperClass: ComputedRef<string>
  quickLinksGrouping: ComputedRef<boolean>
}

const BOOKMARK_ITEM_CONTEXT: InjectionKey<BookmarkItemContext> = Symbol('bookmarkItemContext')

export function provideBookmarkItemContext(context: BookmarkItemContext) {
  provide(BOOKMARK_ITEM_CONTEXT, context)
}

export function useBookmarkItemContext() {
  const context = inject(BOOKMARK_ITEM_CONTEXT)
  if (!context) {
    throw new Error('BookmarkItem must be rendered under the Bookmark component')
  }
  return context
}
