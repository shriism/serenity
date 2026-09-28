import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)

/** A running Serenity window, driven over the Chrome DevTools protocol. */
export interface Harness {
  child: ChildProcess
  logs(): string
  /** Evaluates an expression (awaiting promises) in the renderer and returns its value. */
  evaluate<T = unknown>(expression: string, timeout?: number): Promise<T>
  /** Sends a DevTools protocol command to the renderer. */
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  screenshot(): Promise<Buffer>
  close(): Promise<void>
}

/**
 * Launches Serenity on `workspace` (or, given an empty string, with none chosen yet) in a temporary browser profile, in the background (no window, no focus) unless
 * `SERENITY_SMOKE_VISIBLE` is set, and waits until its preload bridge is ready.
 */
export async function launch(workspace: string, options: { executable?: string; keepProfile?: boolean; profile?: string; width?: number; height?: number; windowSize?: string } = {}): Promise<Harness> {
  const electron = options.executable ?? require('electron') as string
  const profile = options.keepProfile ? null : options.profile ?? await mkdtemp(join(tmpdir(), 'serenity-profile-'))
  // A profile passed in belongs to the caller, who may launch again with it.
  const ownsProfile = !options.keepProfile && !options.profile
  const port = 20000 + Math.floor(Math.random() * 30000)
  const child = spawn(electron, [`--remote-debugging-port=${port}`, ...(profile ? [`--user-data-dir=${profile}`] : []),
    '--background', ...(process.env.SERENITY_SMOKE_VISIBLE ? ['--show-window'] : []), ...(options.windowSize ? [`--window-size=${options.windowSize}`] : []), ...(options.executable ? [] : ['.']), ...(workspace ? [`--workspace=${workspace}`] : [])],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } })
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })

  let url = ''
  let sequence = 0
  type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  type Connection = { socket: WebSocket; ready: Promise<void>; pending: Map<number, Pending> }
  const connections = new Map<string, Connection>()
  function connection(target: string): Connection {
    const existing = connections.get(target)
    if (existing) return existing
    const socket = new WebSocket(target)
    const pending = new Map<number, Pending>()
    const ready = new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => reject(new Error('Could not connect to the renderer')), { once: true })
    })
    const current = { socket, ready, pending }
    connections.set(target, current)
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } }
      const request = message.id === undefined ? undefined : pending.get(message.id)
      if (!request) return
      pending.delete(message.id!)
      clearTimeout(request.timer)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
    })
    socket.addEventListener('close', () => {
      if (connections.get(target) === current) connections.delete(target)
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(new Error('Renderer connection closed'))
      }
      pending.clear()
    })
    return current
  }
  async function send<T>(method: string, params: Record<string, unknown> = {}, timeout = 30000, target = url): Promise<T> {
    // Emulation and input state belong to a CDP session. A new socket per command
    // silently resets them on disconnect, especially in hidden Windows windows.
    const current = connection(target)
    await current.ready
    const id = ++sequence
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        current.pending.delete(id)
        reject(new Error(`${method} timed out. App logs: ${output.slice(-1500)}`))
      }, timeout)
      current.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      current.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async function evaluate<T>(expression: string, timeout = 30000, target = url): Promise<T> {
    const result = await send<{ result?: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true }, timeout, target)
    if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}\nApp logs: ${output.slice(-3000)}`)
    return result.result?.value as T
  }

  for (let attempt = 0; attempt < 80 && !url; attempt++) {
    if (child.exitCode !== null) throw new Error(`Electron exited before opening a window.\n${output}`)
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[]
      const page = pages.find((item) => item.type === 'page')
      if (page) {
        const ready = await evaluate<{ bridge: string; title: string }>('({ bridge: typeof window.serenity?.refresh, title: document.title })', 5000, page.webSocketDebuggerUrl)
        if (ready.bridge === 'function' && ready.title === 'Serenity') url = page.webSocketDebuggerUrl
      }
    } catch { /* The renderer may still be loading. */ }
    if (!url) await delay(200)
  }
  if (!url) { child.kill('SIGKILL'); throw new Error(`Desktop window or preload bridge did not start.\n${output}`) }
  // Hidden desktop windows otherwise lose input focus and can stop producing frames
  // on CI. Emulate a foreground page without taking focus from the developer.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  if (options.width && options.height) await send('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height, deviceScaleFactor: 2, mobile: false })
  const viewport = await evaluate<{ width: number; height: number; focused: boolean }>('({ width: innerWidth, height: innerHeight, focused: document.hasFocus() })')
  if (!viewport.focused || (options.width && options.height && (viewport.width !== options.width || viewport.height !== options.height))) {
    for (const current of connections.values()) current.socket.close()
    child.kill('SIGKILL')
    throw new Error(`Desktop input emulation did not persist: ${JSON.stringify(viewport)}`)
  }

  return {
    child, logs: () => output, evaluate: (expression, timeout) => evaluate(expression, timeout), send: (method, params) => send(method, params),
    screenshot: async () => Buffer.from((await send<{ data: string }>('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
    close: async () => {
      for (const current of connections.values()) current.socket.close()
      if (child.exitCode === null) {
        child.kill('SIGTERM')
        await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3000)])
        if (child.exitCode === null) child.kill('SIGKILL')
      }
      if (profile && ownsProfile) await rm(profile, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

/** Renderer-side helpers, prepended to evaluated scripts: waiting, clicking by text, and placing the cursor in an editor. */
export const helpers = `
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (check, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { const value = check(); if (value) return value; await sleep(50) } return null };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
// In a small window the sidebar starts closed and floats over the panes; open it as a person would before using it.
const showSidebar = async () => { if (!$('.app').classList.contains('left-open')) { click($('button[aria-label="Show sidebar"]')); await sleep(300) } };
const byText = (selector, text) => $$(selector).find((element) => element.textContent.trim() === text || element.getAttribute('aria-label') === text);
const click = (element) => { if (!element) throw new Error('Nothing to click'); element.click() };
const setValue = (element, value) => { const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) };
const focusEnd = (content) => { content.focus(); const range = document.createRange(); range.selectNodeContents(content); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range) };
`
