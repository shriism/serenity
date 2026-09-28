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
export async function launch(workspace: string, options: { executable?: string; keepProfile?: boolean; width?: number; height?: number } = {}): Promise<Harness> {
  const electron = options.executable ?? require('electron') as string
  const profile = options.keepProfile ? null : await mkdtemp(join(tmpdir(), 'serenity-profile-'))
  const port = 20000 + Math.floor(Math.random() * 30000)
  const child = spawn(electron, [`--remote-debugging-port=${port}`, ...(profile ? [`--user-data-dir=${profile}`] : []),
    ...(process.env.SERENITY_SMOKE_VISIBLE ? [] : ['--background']), ...(options.executable ? [] : ['.']), ...(workspace ? [`--workspace=${workspace}`] : [])],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } })
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })

  let url = ''
  let sequence = 0
  function send<T>(method: string, params: Record<string, unknown> = {}, timeout = 30000, target = url): Promise<T> {
    const socket = new WebSocket(target)
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error(`${method} timed out. App logs: ${output.slice(-1500)}`)) }, timeout)
      socket.addEventListener('open', () => socket.send(JSON.stringify({ id, method, params })))
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { id?: number; result?: T; error?: { message: string } }
        if (message.id !== id) return
        clearTimeout(timer)
        socket.close()
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result as T)
      })
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to the renderer')) })
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
  if (options.width && options.height) await send('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height, deviceScaleFactor: 2, mobile: false })

  return {
    child, logs: () => output, evaluate: (expression, timeout) => evaluate(expression, timeout), send: (method, params) => send(method, params),
    screenshot: async () => Buffer.from((await send<{ data: string }>('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
    close: async () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM')
        await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3000)])
        if (child.exitCode === null) child.kill('SIGKILL')
      }
      if (profile) await rm(profile, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

/** Renderer-side helpers, prepended to evaluated scripts: waiting, clicking by text, and placing the cursor in an editor. */
export const helpers = `
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (check, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { const value = check(); if (value) return value; await sleep(50) } return null };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const byText = (selector, text) => $$(selector).find((element) => element.textContent.trim() === text || element.getAttribute('aria-label') === text);
const click = (element) => { if (!element) throw new Error('Nothing to click'); element.click() };
const setValue = (element, value) => { const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) };
const focusEnd = (content) => { content.focus(); const range = document.createRange(); range.selectNodeContents(content); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range) };
`
