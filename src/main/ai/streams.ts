import { cancelled, ProviderError, type InferenceOptions } from './model-provider'

export interface ServerEvent { event?: string; data: string }

/** Reads a text/event-stream body into events, following the WHATWG server-sent events framing. */
export async function* serverEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<ServerEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event: string | undefined
  let data: string[] = []
  const abort = (): void => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    for (;;) {
      if (signal?.aborted) throw cancelled()
      const { value, done } = await reader.read()
      if (signal?.aborted) throw cancelled()
      buffer += decoder.decode(value, { stream: !done })
      // A stream may end without the blank line that dispatches its last event.
      if (done) buffer += '\n\n'
      let newline: number
      while ((newline = buffer.search(/\r\n|\r|\n/)) >= 0) {
        // A lone CR at the end of a chunk may be the first half of CRLF.
        if (buffer[newline] === '\r' && newline === buffer.length - 1) break
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + (buffer.startsWith('\r\n', newline) ? 2 : 1))
        if (!line) {
          if (data.length) yield { ...(event ? { event } : {}), data: data.join('\n') }
          event = undefined
          data = []
          continue
        }
        if (line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        const content = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') event = content
        else if (field === 'data') data.push(content)
      }
      if (done) return
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}

/** A readable error from a failed HTTP response, keeping the service's own code and request id when present. */
export async function responseError(response: Response, service: string): Promise<ProviderError> {
  const text = await response.text().catch(() => '')
  let code: string | undefined
  let message = text.slice(0, 500)
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object') {
      const error = 'error' in parsed && parsed.error && typeof parsed.error === 'object' ? parsed.error as Record<string, unknown> : undefined
      if (error && typeof error.message === 'string') message = error.message
      else if ('error' in parsed && typeof parsed.error === 'string') message = parsed.error
      else if ('detail' in parsed && typeof parsed.detail === 'string') message = parsed.detail
      if (error && typeof error.code === 'string') code = error.code
    }
  } catch { /* Not JSON; keep the text. */ }
  const request = response.headers.get('x-request-id')
  return new ProviderError(`${service} returned ${response.status}${message ? `: ${message}` : ''}${request ? ` (request ${request})` : ''}`, code, response.status)
}

/**
 * Collects a streamed Responses API answer. Success is only `response.completed`; a stream that ends without it, or a
 * `response.failed`/`response.incomplete`/`error` event, is an error.
 */
export async function readResponsesStream(body: ReadableStream<Uint8Array>, options: InferenceOptions, service: string,
  describe: (code: string | undefined, message: string) => string = (_code, message) => message): Promise<{ text: string; model?: string }> {
  let text = ''
  for await (const item of serverEvents(body, options.signal)) {
    if (item.data === '[DONE]') break
    let event: Record<string, unknown>
    try { event = JSON.parse(item.data) as Record<string, unknown> } catch { continue }
    const type = typeof event.type === 'string' ? event.type : item.event
    if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
      text += event.delta
      options.onText?.(event.delta)
    } else if (type === 'response.completed') {
      const response = event.response as { model?: unknown; output?: unknown } | undefined
      const final = outputText(response?.output)
      return { text: final ?? text, ...(typeof response?.model === 'string' ? { model: response.model } : {}) }
    } else if (type === 'response.failed' || type === 'error') {
      const error = ((event.response as { error?: unknown } | undefined)?.error ?? event.error ?? event) as { code?: unknown; message?: unknown }
      const code = typeof error.code === 'string' ? error.code : undefined
      const message = typeof error.message === 'string' ? error.message : 'The response failed'
      throw new ProviderError(`${service}: ${describe(code, message)}`, code)
    } else if (type === 'response.incomplete') {
      const reason = (event.response as { incomplete_details?: { reason?: unknown } } | undefined)?.incomplete_details?.reason
      throw new ProviderError(`${service} stopped before finishing${typeof reason === 'string' ? ` (${reason})` : ''}.`, 'incomplete')
    }
  }
  throw new ProviderError(`${service} ended the response before it was complete.`, 'interrupted')
}

function outputText(output: unknown): string | undefined {
  if (!Array.isArray(output)) return undefined
  const parts = output.flatMap((item) => item && typeof item === 'object' && Array.isArray(item.content) ? item.content : [])
    .filter((part) => part && typeof part === 'object' && part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text as string)
  return parts.length ? parts.join('') : undefined
}

/** Reads a newline-delimited JSON body, one object per line, as Ollama streams its responses. */
export async function* jsonLines(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const abort = (): void => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    for (;;) {
      if (signal?.aborted) throw cancelled()
      const { value, done } = await reader.read()
      if (signal?.aborted) throw cancelled()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = done ? '' : lines.pop()!
      for (const line of lines) {
        if (!line.trim()) continue
        try { yield JSON.parse(line) as Record<string, unknown> } catch { /* A malformed line carries no usable text. */ }
      }
      if (done) return
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}

/**
 * Collects a streamed Ollama chat answer. Reasoning a model writes inside <think> tags is left out of the answer; only
 * the final `done` object marks success.
 */
export async function readOllamaStream(body: ReadableStream<Uint8Array>, options: InferenceOptions, service: string): Promise<{ text: string; model?: string }> {
  let raw = ''
  let shown = 0
  let model: string | undefined
  for await (const chunk of jsonLines(body, options.signal)) {
    if (typeof chunk.error === 'string') throw new ProviderError(`${service}: ${chunk.error}`)
    if (typeof chunk.model === 'string') model = chunk.model
    const content = (chunk.message as { content?: unknown } | undefined)?.content
    if (typeof content === 'string' && content) {
      raw += content
      const visible = withoutThinking(raw, chunk.done !== true)
      if (visible.length > shown) { options.onText?.(visible.slice(shown)); shown = visible.length }
    }
    if (chunk.done === true) return { text: withoutThinking(raw, false), ...(model ? { model } : {}) }
  }
  throw new ProviderError(`${service} ended the response before it was complete.`, 'interrupted')
}

/** Text after any leading <think>…</think> block; while the block is still open, nothing is visible yet. */
function withoutThinking(text: string, streaming: boolean): string {
  const start = text.trimStart()
  if (!start.startsWith('<think>')) return streaming && '<think>'.startsWith(start) ? '' : text
  const end = start.indexOf('</think>')
  return end < 0 ? '' : start.slice(end + '</think>'.length).trimStart()
}

/** Aborts `fetch` when either the caller cancels or the time limit passes, and says which one happened. */
export function requestSignal(signal: AbortSignal | undefined, timeout: number): { signal: AbortSignal; timedOut(): boolean; done(): void } {
  const controller = new AbortController()
  let expired = false
  const timer = setTimeout(() => { expired = true; controller.abort() }, timeout)
  const abort = (): void => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  return { signal: controller.signal, timedOut: () => expired, done: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) } }
}
