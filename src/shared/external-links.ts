/** Web and email links that may be handed to the system; anything else (file:, javascript:, custom schemes) is refused. */
export function externalLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    if (url.protocol === 'mailto:') return url.href
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname) return url.href
  } catch { /* Not a URL. */ }
  return null
}
