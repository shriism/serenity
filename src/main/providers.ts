import type { Provider } from '../shared/types'
import { getCredential } from './credentials'

export async function askProvider(provider: Provider, workspace: string, prompt: string): Promise<string> {
  if (provider === 'copilot') {
    const { CopilotClient } = await import('@github/copilot-sdk')
    const token = await getCredential('copilot')
    const client = new CopilotClient({ mode: 'empty', workingDirectory: workspace, ...(token ? { gitHubToken: token } : {}) })
    await client.start()
    try {
      const session = await client.createSession({
        workingDirectory: workspace,
        availableTools: [],
        onPermissionRequest: () => ({ kind: 'reject', feedback: 'Serenity handles knowledge changes through reviewed proposals.' })
      })
      try {
        const answer = await session.sendAndWait({ prompt }, 120000)
        if (!answer?.data.content) throw new Error('Copilot returned no answer.')
        return answer.data.content
      } finally { await session.disconnect() }
    } finally { await client.stop() }
  }

  if (provider === 'codex') {
    const { Codex } = await import('@openai/codex-sdk')
    const key = await getCredential('codex')
    const codex = new Codex(key ? { apiKey: key } : {})
    const thread = codex.startThread({
      workingDirectory: workspace,
      skipGitRepoCheck: true,
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: false
    })
    const turn = await thread.run(prompt)
    if (!turn.finalResponse) throw new Error('Codex returned no answer.')
    return turn.finalResponse
  }

  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const key = await getCredential('claude')
  const run = query({
    prompt,
    options: {
      cwd: workspace,
      ...(key ? { env: { ...process.env, ANTHROPIC_API_KEY: key } } : {}),
      tools: [],
      settingSources: [],
      maxTurns: 2,
      canUseTool: async () => ({ behavior: 'deny', message: 'Serenity handles knowledge changes through reviewed proposals.' })
    }
  })
  for await (const message of run) {
    if (message.type === 'result') {
      if (message.subtype !== 'success') throw new Error(message.errors.join('; ') || 'Claude could not complete the request.')
      if (message.is_error) throw new Error(message.result || 'Claude could not complete the request.')
      return message.result
    }
  }
  throw new Error('Claude returned no answer.')
}
