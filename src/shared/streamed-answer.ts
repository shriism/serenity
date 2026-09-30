const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }

/**
 * The part of an assistant answer that has arrived so far. Serenity asks for a JSON object with an `answer` field, so
 * that field is decoded as far as it goes; a reply that is plainly not JSON is shown as written.
 */
export function streamedAnswer(buffer: string): string {
  const start = buffer.trimStart()
  if (start && !start.startsWith('{') && !start.startsWith('`')) return buffer
  const match = /"answer"\s*:\s*"/.exec(buffer)
  if (!match) return ''
  let text = ''
  for (let index = match.index + match[0].length; index < buffer.length; index++) {
    const character = buffer[index]
    if (character === '"') break
    if (character !== '\\') { text += character; continue }
    const next = buffer[index + 1]
    if (next === undefined) break
    if (next === 'u') {
      const hex = buffer.slice(index + 2, index + 6)
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break
      text += String.fromCharCode(Number.parseInt(hex, 16))
      index += 5
      continue
    }
    text += escapes[next] ?? next
    index++
  }
  return text
}
