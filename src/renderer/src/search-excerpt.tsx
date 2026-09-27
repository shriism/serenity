/** Renders a search excerpt, emphasizing the words the index marked with U+0001 … U+0002. */
export function highlighted(excerpt: string) {
  return excerpt.split(/(\u0001[^\u0002]*\u0002)/).map((part, index) =>
    part.startsWith('\u0001') ? <mark key={index}>{part.slice(1, -1)}</mark> : part)
}
