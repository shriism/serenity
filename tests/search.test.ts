import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../src/main/workspace'
import { rankSearchResults } from '../src/shared/search-rank'

test('search prefers the named record, then records matching every word', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-search-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    await workspace.saveEntity({ id: '', title: 'Notes about people', type: 'note', body: 'Alex Alex Alex mentioned many times. Alex again.' })
    await workspace.saveEntity({ id: '', title: 'Alex', type: 'person', body: 'Met at the club.' })
    await workspace.saveEntity({ id: '', title: 'Chess club', type: 'group', body: 'Weekly games.' })
    await workspace.saveEntity({ id: '', title: 'Robotics Club', type: 'group', body: 'Builds rovers.' })
    await writeFile(join(directory, 'documents', 'minutes.md'), 'Alex Alex Alex Alex Alex Alex')
    workspace.markDirty()
    assert.equal((await workspace.search('alex'))[0].title, 'Alex', 'a title match outranks repeated mentions in text')
    assert.equal((await workspace.search('robotics club'))[0].title, 'Robotics Club', 'all words before some words')
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('ranking puts exact then prefix title matches first and removes duplicates', () => {
  const result = (title: string, id = title) => ({ kind: 'entity' as const, id, title, detail: '' })
  assert.deepEqual(rankSearchResults('Sam', [result('Samantha'), result('Notes'), result('sam'), result('Notes')]).map((item) => item.title),
    ['sam', 'Samantha', 'Notes'])
})

test('concurrent searches share one index rebuild and a change during it is picked up', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-search-refresh-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    await workspace.saveEntity({ id: '', title: 'Alpha', type: 'thing', body: '' })
    const [first, second] = await Promise.all([workspace.search('alpha'), workspace.search('alpha'), workspace.refreshSearchIndex()])
    assert.equal(first[0].title, 'Alpha')
    assert.equal(second[0].title, 'Alpha')
    const rebuilding = workspace.refreshSearchIndex()
    await workspace.saveEntity({ id: '', title: 'Beta', type: 'thing', body: '' })
    await rebuilding
    assert.equal((await workspace.search('beta'))[0]?.title, 'Beta')
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
