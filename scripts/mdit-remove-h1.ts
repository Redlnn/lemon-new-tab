import MarkdownExit from 'markdown-exit'

export function removeH1Plugin(md: MarkdownExit) {
  md.core.ruler.push('remove_h1', (state) => {
    const tokens: typeof state.tokens = []
    let skip = false

    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i]

      if (token.type === 'heading_open' && token.tag === 'h1') {
        skip = true // 开始丢弃 H1
        continue
      }
      if (token.type === 'heading_close' && token.tag === 'h1') {
        skip = false // 结束丢弃
        continue
      }

      if (!skip) {
        tokens.push(token)
      }
    }

    state.tokens = tokens
  })
}
