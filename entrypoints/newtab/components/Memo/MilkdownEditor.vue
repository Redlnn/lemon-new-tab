<script setup lang="ts">
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { EditorViewReady } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import '@milkdown/crepe/theme/common/style.css'
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

    if (editorDom.parentElement?.classList.contains('memo-editor-frame')) {
      return
    }

    const frame = document.createElement('div')
    frame.className = 'memo-editor-frame'

    editorDom.before(frame)

    frame.appendChild(editorDom)

    const footer = document.createElement('div')
    footer.className = 'memo-editor-footer'

    const footerIcon = document.createElement('img')
    footerIcon.src = '/memo-icon.png'
    footer.appendChild(footerIcon)

    const footerTitle = document.createElement('span')
    footerTitle.classList.add('memo-editor-footer__title')
    footerTitle.innerHTML = 'Lemon New Tab'

    const footerSubtitle = document.createElement('span')
    footerSubtitle.classList.add('memo-editor-footer__subtitle')
    footerSubtitle.innerHTML = 'Powered by Redlnn'

    for (let i = 1; i < 5; i++) {
      const span = document.createElement('span')
      span.className = `memo-editor-corner`
      span.dataset.index = String(i)
      frame.appendChild(span)
    }

    footerTitle.appendChild(footerSubtitle)
    footer.appendChild(footerTitle)

    frame.appendChild(footer)
  }
}

const crepeRef = shallowRef<Crepe>()

useEditor((root) => {
  const crepe = new Crepe({
    root,
    defaultValue: content.value,
    features: {
      [Crepe.Feature.Cursor]: true,
      [Crepe.Feature.ListItem]: true,
      [Crepe.Feature.LinkTooltip]: false,
      [Crepe.Feature.ImageBlock]: false,
      [Crepe.Feature.BlockEdit]: false,
      [Crepe.Feature.Placeholder]: true,
      [Crepe.Feature.Toolbar]: false,
      [Crepe.Feature.CodeMirror]: true,
      [Crepe.Feature.Table]: true,
      [Crepe.Feature.Latex]: false,
      [Crepe.Feature.TopBar]: true,
      [Crepe.Feature.AI]: false,
    },
    featureConfigs: {
      [Crepe.Feature.TopBar]: {
        headingOptions: [
          { label: 'Text', level: null },
          { label: 'H1', level: 1 },
          { label: 'H2', level: 2 },
          { label: 'H3', level: 3 },
          { label: 'H4', level: 4 },
          { label: 'H5', level: 5 },
          { label: 'H6', level: 6 },
        ],
      },
    },
  })

  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, markdown, prevMarkdown) => {
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

function syncTopBarVisibility(crepe: Crepe, isReadonly: boolean) {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const topBar = view.dom.parentElement?.querySelector<HTMLElement>('.milkdown-top-bar')
    if (topBar) topBar.style.display = isReadonly ? 'none' : ''
  })
}

watch(readonly, (isReadonly) => {
  const crepe = crepeRef.value
  if (!crepe) return
  crepe.setReadonly(isReadonly)
  nextTick(() => syncTopBarVisibility(crepe, isReadonly))
})

watch(content, (markdown) => {
  const crepe = crepeRef.value
  if (!crepe || crepe.getMarkdown() === markdown) return
  crepe.editor.action(replaceAll(markdown))
})
</script>

<template>
  <Milkdown />
</template>
