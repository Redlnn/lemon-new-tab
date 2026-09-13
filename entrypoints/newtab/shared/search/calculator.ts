type Token =
  | { type: 'number'; value: number }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' | '^' }
  | { type: 'leftParen' | 'rightParen' }

function tokenize(input: string): Token[] | null {
  const text = input
    .trim()
    .replace(/\s+/g, '')
    .replace(/[×÷]/g, (operator) => (operator === '×' ? '*' : '/'))
  const expression = text.endsWith('=') ? text.slice(0, -1) : text
  if (!expression || expression.includes('=')) return null

  const tokens: Token[] = []
  let index = 0
  while (index < expression.length) {
    const rest = expression.slice(index)
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)/)?.[0]
    if (number) {
      tokens.push({ type: 'number', value: Number(number) })
      index += number.length
      continue
    }
    if (rest.startsWith('**')) {
      tokens.push({ type: 'operator', value: '^' })
      index += 2
      continue
    }

    const character = expression[index]
    if (
      character === '+' ||
      character === '-' ||
      character === '*' ||
      character === '/' ||
      character === '^'
    )
      tokens.push({ type: 'operator', value: character })
    else if (character === '(') tokens.push({ type: 'leftParen' })
    else if (character === ')') tokens.push({ type: 'rightParen' })
    else return null
    index += 1
  }
  return tokens
}

/** 解析仅由数字、基础运算符和括号组成的表达式；不执行用户输入的脚本。 */
export function calculateExpression(input: string): number | null {
  const tokens = tokenize(input)
  if (!tokens) return null

  let index = 0
  const peek = () => tokens[index]
  const consume = () => tokens[index++]
  const peekOperator = () => {
    const token = peek()
    return token?.type === 'operator' ? token.value : undefined
  }

  function parsePrimary(): number | null {
    const token = consume()
    if (token?.type === 'number') return token.value
    if (token?.type !== 'leftParen') return null
    const value = parseAdditive()
    return value === null || consume()?.type !== 'rightParen' ? null : value
  }

  function parseUnary(): number | null {
    const token = peek()
    if (token?.type === 'operator' && (token.value === '+' || token.value === '-')) {
      consume()
      const value = parseUnary()
      return value === null ? null : token.value === '-' ? -value : value
    }
    return parsePower()
  }

  function parsePower(): number | null {
    const left = parsePrimary()
    if (left === null) return null
    if (peekOperator() !== '^') return left
    consume()
    const right = parseUnary()
    return right === null ? null : left ** right
  }

  function parseMultiplicative(): number | null {
    let value = parseUnary()
    while (value !== null && ['*', '/'].includes(peekOperator() ?? '')) {
      const operator = peekOperator()!
      consume()
      const right = parseUnary()
      if (right === null || (operator === '/' && right === 0)) return null
      value = operator === '*' ? value * right : value / right
    }
    return value
  }

  function parseAdditive(): number | null {
    let value = parseMultiplicative()
    while (value !== null && ['+', '-'].includes(peekOperator() ?? '')) {
      const operator = peekOperator()!
      consume()
      const right = parseMultiplicative()
      if (right === null) return null
      value = operator === '+' ? value + right : value - right
    }
    return value
  }

  const result = parseAdditive()
  return result === null || index !== tokens.length || !Number.isFinite(result) ? null : result
}

export function hasCalculationOperator(input: string): boolean {
  return /[+\-*/^×÷]/.test(input)
}
