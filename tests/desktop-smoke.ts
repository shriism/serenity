import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const electron = require('electron') as string
const port = 20000 + Math.floor(Math.random() * 30000)
const child = spawn(electron, [`--remote-debugging-port=${port}`, '.'], { stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })

async function evaluate(url: string): Promise<unknown> {
  const socket = new WebSocket(url)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.close(); reject(new Error('Renderer evaluation timed out')) }, 10000)
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
      expression: '({ bridge: typeof window.serenity?.chooseWorkspace, title: document.title })', returnByValue: true
    } })))
    socket.addEventListener('message', (event) => {
      const result = JSON.parse(String(event.data)) as { id?: number; result?: { result?: { value?: unknown } } }
      if (result.id !== 1) return
      clearTimeout(timeout)
      socket.close()
      resolve(result.result?.result?.value)
    })
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Could not connect to the renderer')) })
  })
}

try {
  let connected = false
  let observed: unknown = null
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) throw new Error(`Electron exited before opening a window.\n${output}`)
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[]
      const page = pages.find((item) => item.type === 'page')
      if (page) {
        const result = await evaluate(page.webSocketDebuggerUrl) as { bridge: string; title: string }
        observed = result
        if (result.bridge === 'function' && result.title === 'Serenity') { connected = true; break }
      }
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error
    }
    await delay(200)
  }
  assert.ok(connected, `Desktop window or preload bridge did not start. Observed ${JSON.stringify(observed)}\n${output}`)
  console.log('Electron window and preload bridge started successfully.')
} finally {
  child.kill()
}
