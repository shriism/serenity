/** Drops Markdown syntax and empty metadata that read as noise in a one-line excerpt. */
function plain(text: string): string {
  return text.replace(/\{\}/g, '').replace(/\[\[|\]\]|\*\*|__|`+/g, '')
    .replace(/(^|\s)(#{1,6}|>|[-*+](?: \[[ xX]\])?|\d+\.)(?=\s)/g, '$1').replace(/\s+/g, ' ').trim()
}

/** Renders a search excerpt, emphasizing the words the index marked with U+0001 … U+0002. */
export function highlighted(excerpt: string) {
  return plain(excerpt).split(/(\u0001[^\u0002]*\u0002)/).map((part, index) =>
    part.startsWith('\u0001') ? <mark key={index}>{part.slice(1, -1)}</mark> : part)
}
