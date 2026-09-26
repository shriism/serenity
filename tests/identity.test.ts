import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identityCandidates } from '../src/shared/identity'

test('identity resolution offers close matches without asserting same identity', () => {
  const candidates = identityCandidates('Alex Chen', 'person', [
    { id: '1', title: 'Alex Chen', type: 'person', body: '' },
    { id: '2', title: 'Alex from club', type: 'person', body: '' },
    { id: '3', title: 'Robotics', type: 'concept', body: '' }
  ])
  assert.deepEqual(candidates.map(({ entity }) => entity.id), ['1', '2'])
  assert.equal(candidates[0].score, 1)
  assert.deepEqual(identityCandidates('', 'person', []), [])
})

test('possible duplicates come with evidence and respect an undone merge', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { Workspace } = await import('../src/main/workspace')
  const { duplicateCandidates } = await import('../src/shared/identity')
  const directory = await mkdtemp(join(tmpdir(), 'serenity-duplicates-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const make = async (title: string, type: string) => (await workspace.saveEntity({ id: '', title, type, body: '' })).entities.find((item) => item.title === title)!
    const alex = await make('Alex', 'person')
    const alexM = await make('Alex M.', 'person')
    const chen = await make('Alex Chen', 'person')
    const rivera = await make('Alex Rivera', 'person')
    const club = await make('Robotics Club', 'group')
    await make('Robotics', 'concept')
    for (const subject of [chen, rivera]) await workspace.addClaim({ subject: subject.id, key: 'email', value: 'alex@example.com', source: 'Contacts' })
    await workspace.addClaim({ subject: alex.id, key: 'member of', value: club.id, source: 'Me' })
    await workspace.addClaim({ subject: alexM.id, key: 'member of', value: club.id, source: 'Me' })
    let pairs = duplicateCandidates(await workspace.snapshot()).map((pair) => ({ pair: `${pair.a.title} / ${pair.b.title}`, reasons: pair.reasons }))
    assert.deepEqual(pairs.find((item) => item.pair === 'Alex / Alex M.')?.reasons, ['Similar names', 'Both are person', 'Both have member of: Robotics Club'])
    assert.deepEqual(pairs.find((item) => item.pair === 'Alex Chen / Alex Rivera')?.reasons, ['Similar names', 'Both are person', 'Both have email: alex@example.com'],
      'shared facts support a weaker name match')
    assert.equal(pairs.some((item) => item.pair === 'Robotics / Robotics Club'), true)
    await workspace.mergeEntities(alexM.id, alex.id)
    await workspace.unmergeEntities(alexM.id, 'Different people')
    pairs = duplicateCandidates(await workspace.snapshot()).map((pair) => ({ pair: `${pair.a.title} / ${pair.b.title}`, reasons: pair.reasons }))
    assert.equal(pairs.some((item) => item.pair === 'Alex / Alex M.'), false, 'an undone merge is a human judgment that they differ')
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('duplicate suggestions stay fast when many entities share a common name word', async () => {
  const { duplicateCandidates } = await import('../src/shared/identity')
  const entities = Array.from({ length: 3000 }, (_, index) => ({ id: `e${index}`, title: `Alex ${['Rivera', 'Kim', 'Patel'][index % 3]} ${index}`, type: 'person', body: '' }))
  const claims = entities.map((entity, index) => ({ id: `c${index}`, subject: entity.id, key: 'type', value: 'student', source: 'Me', origin: 'human' as const, status: 'confirmed' as const, recordedAt: '' }))
  entities.push({ id: 'twin', title: 'Alex Rivera 0', type: 'person', body: '' })
  const started = performance.now()
  const pairs = duplicateCandidates({ entities, claims, mergeHistory: [] })
  assert.ok(performance.now() - started < 2000, 'quadratic pairing on common words would take minutes')
  assert.deepEqual(pairs.map((pair) => [pair.a.id, pair.b.id].sort()), [['e0', 'twin']], 'identical titles are still found')
})
