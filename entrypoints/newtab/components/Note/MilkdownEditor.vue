<script setup lang="ts">
import { CrepeBuilder } from '@milkdown/crepe/builder'
import { cursor } from '@milkdown/crepe/feature/cursor'
import { listItem } from '@milkdown/crepe/feature/list-item'
import { placeholder } from '@milkdown/crepe/feature/placeholder'
import { table } from '@milkdown/crepe/feature/table'
import { topBar } from '@milkdown/crepe/feature/top-bar'
import { editorViewCtx } from '@milkdown/kit/core'
import { EditorViewReady } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import '@milkdown/crepe/theme/common/prosemirror.css'
import '@milkdown/crepe/theme/common/reset.css'
import '@milkdown/crepe/theme/common/cursor.css'
import '@milkdown/crepe/theme/common/list-item.css'
import '@milkdown/crepe/theme/common/placeholder.css'
import '@milkdown/crepe/theme/common/table.css'
import '@milkdown/crepe/theme/common/top-bar.css'
import '@milkdown/crepe/theme/frame.css'

import { replaceAll } from '@milkdown/kit/utils'
import { Milkdown, useEditor } from '@milkdown/vue'

const content = defineModel<string>('content', { default: '' })
const readonly = defineModel<boolean>('readonly', { default: false })

const editorFramePlugin: MilkdownPlugin = (ctx) => {
  return async () => {
    await ctx.wait(EditorViewReady)

    const view = ctx.get(editorViewCtx)
    const editorDom = view.dom

    if (editorDom.parentElement?.classList.contains('note-editor-frame')) {
      return
    }

    const frame = document.createElement('div')
    frame.className = 'note-editor-frame'

    editorDom.before(frame)

    frame.appendChild(editorDom)

    const footer = document.createElement('div')
    footer.className = 'note-editor-footer'

    const footerIcon = document.createElement('img')
    footerIcon.src = '/note-icon.png'
    footer.appendChild(footerIcon)

    const footerTitle = document.createElement('span')
    footerTitle.classList.add('note-editor-footer__title')
    footerTitle.innerHTML = 'Lemon New Tab'

    const footerSubtitle = document.createElement('span')
    footerSubtitle.classList.add('note-editor-footer__subtitle')
    footerSubtitle.innerHTML = 'Powered by Redlnn'

    for (let i = 1; i < 5; i++) {
      const span = document.createElement('span')
      span.className = `note-editor-corner`
      span.dataset.index = String(i)
      frame.appendChild(span)
    }

    footerTitle.appendChild(footerSubtitle)
    footer.appendChild(footerTitle)

    frame.appendChild(footer)
  }
}

const crepeRef = shallowRef<CrepeBuilder>()
let editorMarkdown = content.value

useEditor((root) => {
  const crepe = new CrepeBuilder({
    root,
    defaultValue: content.value,
  })
    .addFeature(cursor)
    .addFeature(listItem)
    .addFeature(placeholder)
    .addFeature(table)
    .addFeature(topBar, {
      headingOptions: [
        { label: 'Text', level: null },
        { label: 'H1', level: 1 },
        { label: 'H2', level: 2 },
        { label: 'H3', level: 3 },
        { label: 'H4', level: 4 },
        { label: 'H5', level: 5 },
        { label: 'H6', level: 6 },
      ],
    })

  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, markdown, prevMarkdown) => {
      editorMarkdown = markdown
      if (markdown !== prevMarkdown) {
        content.value = markdown
      }
    })
  })

  crepe.editor.use(editorFramePlugin)
  crepe.setReadonly(readonly.value)
  crepeRef.value = crepe

  return crepe
})

watch(readonly, (isReadonly) => {
  const crepe = crepeRef.value
  if (!crepe) return
  crepe.setReadonly(isReadonly)
})

watch(content, (markdown) => {
  const crepe = crepeRef.value
  if (!crepe || editorMarkdown === markdown) return
  editorMarkdown = markdown
  crepe.editor.action(replaceAll(markdown))
})
</script>

<template>
  <Milkdown />
</template>
