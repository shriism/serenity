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

test('a distinct-identity decision persists, hides the pair, blocks merging, and can be undone', async () => {
  const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const YAML = (await import('yaml')).default
  const { Workspace } = await import('../src/main/workspace')
  const { duplicateCandidates } = await import('../src/shared/identity')
  const directory = await mkdtemp(join(tmpdir(), 'serenity-distinct-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const first = (await workspace.saveEntity({ id: '', title: 'Alex', type: 'person', body: '' })).entities[0]
    const second = (await workspace.saveEntity({ id: '', title: 'Alex M.', type: 'person', body: '' })).entities.find((entity) => entity.id !== first.id)!
    assert.equal(duplicateCandidates(await workspace.snapshot()).length, 1)
    const decided = await workspace.markDistinctEntities(second.id, first.id)
    assert.equal(decided.identityDecisions.length, 1)
    const decision = decided.identityDecisions[0]
    const saved = YAML.parse(await readFile(join(directory, 'identity-decisions', `${decision.id}.yaml`), 'utf8'))
    assert.deepEqual([saved.left, saved.right], [first.id, second.id].sort())
    assert.equal(saved.version, 1)
    assert.equal(duplicateCandidates(decided).length, 0)
    await assert.rejects(workspace.markDistinctEntities(first.id, second.id), /already marked distinct/)
    await assert.rejects(workspace.mergeEntities(first.id, second.id), /Undo that decision/)
    workspace.close()
    const reopened = new Workspace(directory)
    await reopened.initialize()
    assert.equal(duplicateCandidates(await reopened.snapshot()).length, 0)
    const undone = await reopened.undoIdentityDecision(decision.id)
    assert.ok(undone.identityDecisions[0].undoneAt)
    assert.equal(duplicateCandidates(undone).length, 1)
    await assert.rejects(reopened.undoIdentityDecision(decision.id), /already undone/)
    const malformedId = '123e4567-e89b-42d3-a456-426614174082'
    await writeFile(join(directory, 'identity-decisions', `${malformedId}.yaml`), YAML.stringify({ version: 2, id: malformedId, kind: 'distinct', left: first.id, right: second.id, recordedAt: '2026-09-26' }))
    const inspected = await reopened.snapshot()
    assert.equal(inspected.identityDecisions.length, 1, 'an unsupported record version is not applied')
    assert.ok(inspected.errors.some((error) => error.includes(`identity-decisions/${malformedId}.yaml`)))
    assert.equal((await reopened.mergeEntities(first.id, second.id)).merges.length, 1)
    reopened.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('a distinct decision follows later merges without allowing an indirect merge', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { Workspace } = await import('../src/main/workspace')
  const { duplicateCandidates, distinctRepresentatives } = await import('../src/shared/identity')
  const { contextRecords, scopeContextRecords } = await import('../src/main/context')
  const { validateReadScope } = await import('../src/shared/workflow')
  const directory = await mkdtemp(join(tmpdir(), 'serenity-distinct-merge-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const create = async (title: string) => (await workspace.saveEntity({ id: '', title, type: 'person', body: '' })).entities.find((item) => item.title === title && !created.has(item.id))!
    const created = new Set<string>()
    const first = await create('Alex'); created.add(first.id)
    const second = await create('Alex M.'); created.add(second.id)
    const representative = await create('Alex'); created.add(representative.id)
    const decision = (await workspace.markDistinctEntities(first.id, second.id)).identityDecisions[0]
    const merged = await workspace.mergeEntities(first.id, representative.id)
    assert.deepEqual(distinctRepresentatives(decision, merged.merges).sort(), [representative.id, second.id].sort(), 'the decision resolves through the merge')
    assert.equal(duplicateCandidates(merged).some(({ a, b }) => [a.id, b.id].includes(second.id) && [a.id, b.id].includes(representative.id)), false)
    const records = contextRecords(merged, [])
    const scoped = (ids: string[]) => scopeContextRecords(merged, records, validateReadScope({ mode: 'selected', entityIds: ids,
      documentNames: [], includeOtherConversations: false, includeCalendarAndTasks: false })).some((item) => item.ref === `identity-decision:${decision.id}`)
    assert.equal(scoped([representative.id]), false)
    assert.equal(scoped([representative.id, second.id]), true, 'selected scope uses current identities')
    await assert.rejects(workspace.mergeEntities(second.id, representative.id), /marked distinct/)
    const reopened = await workspace.undoIdentityDecision(decision.id)
    assert.equal(duplicateCandidates(reopened).some(({ a, b }) => [a.id, b.id].includes(second.id) && [a.id, b.id].includes(representative.id)), true)
    assert.equal((await workspace.mergeEntities(second.id, representative.id)).merges.length, 2)
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('concurrent identity writes cannot create conflicting decisions or merges', async () => {
  const { mkdtemp, readdir, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { Workspace } = await import('../src/main/workspace')
  const directory = await mkdtemp(join(tmpdir(), 'serenity-identity-race-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const first = (await workspace.saveEntity({ id: '', title: 'Alex', type: 'person', body: '' })).entities[0]
    const second = (await workspace.saveEntity({ id: '', title: 'Alex M.', type: 'person', body: '' })).entities.find((entity) => entity.id !== first.id)!

    const parallelDecisions = await Promise.allSettled([
      workspace.markDistinctEntities(first.id, second.id),
      workspace.markDistinctEntities(second.id, first.id)
    ])
    assert.deepEqual(parallelDecisions.map((result) => result.status).sort(), ['fulfilled', 'rejected'])
    assert.equal((await readdir(join(directory, 'identity-decisions'))).filter((name) => name.endsWith('.yaml')).length, 1)

    const decision = (await workspace.snapshot()).identityDecisions[0]
    await workspace.undoIdentityDecision(decision.id)
    const parallelWrites = await Promise.allSettled([
      workspace.markDistinctEntities(first.id, second.id),
      workspace.mergeEntities(second.id, first.id)
    ])
    assert.deepEqual(parallelWrites.map((result) => result.status).sort(), ['fulfilled', 'rejected'])
    const snapshot = await workspace.snapshot()
    assert.equal(snapshot.merges.length > 0 && snapshot.identityDecisions.some((item) => !item.undoneAt), false)
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
