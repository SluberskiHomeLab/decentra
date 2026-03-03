// Pure message-formatting logic — no React dependency

export interface FormatToken {
  type: 'text' | 'bold' | 'italic' | 'boldItalic' | 'code' | 'codeBlock' | 'strikethrough' | 'spoiler' | 'quote'
  content: string
  language?: string
}

export function parseMessageFormat(text: string): FormatToken[] {
  const tokens: FormatToken[] = []
  let i = 0

  while (i < text.length) {
    // Check for code block (```)
    if (text.slice(i, i + 3) === '```') {
      let end = text.indexOf('```', i + 3)
      if (end === -1) {
        tokens.push({ type: 'text', content: text.slice(i) })
        break
      }
      const codeContent = text.slice(i + 3, end)
      // Check for language specification (e.g., ```javascript)
      const lines = codeContent.split('\n')
      const firstLine = lines[0].trim()
      let language = ''
      let code = codeContent
      if (firstLine && !firstLine.includes(' ') && lines.length > 1) {
        language = firstLine
        code = lines.slice(1).join('\n')
      }
      tokens.push({ type: 'codeBlock', content: code, language })
      i = end + 3
      continue
    }

    // Check for inline code (`)
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      if (end === -1) {
        tokens.push({ type: 'text', content: text.slice(i) })
        break
      }
      tokens.push({ type: 'code', content: text.slice(i + 1, end) })
      i = end + 1
      continue
    }

    // Check for spoiler (||)
    if (text.slice(i, i + 2) === '||') {
      const end = text.indexOf('||', i + 2)
      if (end === -1) {
        tokens.push({ type: 'text', content: text.slice(i) })
        break
      }
      tokens.push({ type: 'spoiler', content: text.slice(i + 2, end) })
      i = end + 2
      continue
    }

    // Check for strikethrough (~~)
    if (text.slice(i, i + 2) === '~~') {
      const end = text.indexOf('~~', i + 2)
      if (end === -1) {
        tokens.push({ type: 'text', content: text.slice(i) })
        break
      }
      tokens.push({ type: 'strikethrough', content: text.slice(i + 2, end) })
      i = end + 2
      continue
    }

    // Check for bold italic (***)
    if (text.slice(i, i + 3) === '***') {
      const end = text.indexOf('***', i + 3)
      if (end === -1) {
        tokens.push({ type: 'text', content: text.slice(i) })
        break
      }
      tokens.push({ type: 'boldItalic', content: text.slice(i + 3, end) })
      i = end + 3
      continue
    }

    // Check for bold (**)
    if (text.slice(i, i + 2) === '**') {
      const end = text.indexOf('**', i + 2)
      if (end === -1) {
        tokens.push({ type: 'text', content: text.slice(i) })
        break
      }
      tokens.push({ type: 'bold', content: text.slice(i + 2, end) })
      i = end + 2
      continue
    }

    // Check for italic (*)
    if (text[i] === '*') {
      const end = text.indexOf('*', i + 1)
      if (end === -1) {
        tokens.push({ type: 'text', content: text.slice(i) })
        break
      }
      tokens.push({ type: 'italic', content: text.slice(i + 1, end) })
      i = end + 1
      continue
    }

    // Check for quote (> at start of line)
    if ((i === 0 || text[i - 1] === '\n') && text[i] === '>') {
      // Find end of line
      let end = text.indexOf('\n', i)
      if (end === -1) end = text.length
      const quoteContent = text.slice(i + 1, end).trim()
      tokens.push({ type: 'quote', content: quoteContent })
      i = end
      continue
    }

    // Regular text — collect until next special character
    let textEnd = i + 1
    while (textEnd < text.length) {
      const char = text[textEnd]
      const twoChar = text.slice(textEnd, textEnd + 2)
      const threeChar = text.slice(textEnd, textEnd + 3)

      if (char === '`' || char === '*' || twoChar === '~~' || twoChar === '||' || threeChar === '```') {
        break
      }
      if ((textEnd === 0 || text[textEnd - 1] === '\n') && char === '>') {
        break
      }
      textEnd++
    }

    tokens.push({ type: 'text', content: text.slice(i, textEnd) })
    i = textEnd
  }

  return tokens
}
