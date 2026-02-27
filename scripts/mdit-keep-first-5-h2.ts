import MarkdownExit from 'markdown-exit'

/**
 * 保留 Markdown 文档中前 5 个 H2 标签及其子内容
 * H2 的子内容定义为：从 H2 开始到下一个同级或更高级标题（H1/H2）之前的所有内容
 */
export function keepFirst5H2Plugin(md: MarkdownExit) {
  md.core.ruler.push('keep_first_5_h2', (state) => {
    const tokens: typeof state.tokens = []
    let h2Count = 0
    let skipMode = false

    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i]

      // 检测到 H2 标签
      if (token.type === 'heading_open' && token.tag === 'h2') {
        h2Count++

        // 如果已经有 5 个 H2，后续进入跳过模式
        if (h2Count > 5) {
          skipMode = true
          continue
        }
      }

      // 在跳过模式下，跳过所有 token
      if (skipMode) {
        continue
      }

      // 保留 token
      tokens.push(token)
    }

    state.tokens = tokens
  })
}
