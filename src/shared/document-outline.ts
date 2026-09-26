export interface DocumentHeading { title: string; level: number; start: number; end: number }

/** Extract explicit Markdown headings from imported text without guessing headings in PDF or DOCX extraction. */
export function documentOutline(name: string, text: string): DocumentHeading[] {
  if (!name.toLowerCase().endsWith('.md')) return []
  const headings: DocumentHeading[] = []
  let offset = 0
  let fence: { marker: string; length: number } | null = null
  let frontmatter = /^---\r?\n/.test(text)
  for (const line of text.split('\n')) {
    const parsedLine = line.endsWith('\r') ? line.slice(0, -1) : line
    if (frontmatter) {
      if (offset > 0 && /^(---|\.\.\.)\s*$/.test(parsedLine)) frontmatter = false
    } else {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(parsedLine)?.[1]
      if (fence) {
        if (marker?.[0] === fence.marker && marker.length >= fence.length) fence = null
      } else if (marker) fence = { marker: marker[0], length: marker.length }
      else {
        const match = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(parsedLine)
        if (match) {
          const title = match[2].trim()
          if (title) headings.push({ title, level: match[1].length, start: offset, end: offset + parsedLine.length })
          if (headings.length >= 200) break
        }
      }
    }
    offset += line.length + 1
  }
  return headings
}
