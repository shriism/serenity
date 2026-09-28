import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RecentWorkspaces } from '../src/main/recent-workspaces'

test('recent workspaces keep the newest first, without duplicates, and report missing folders', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-recent-'))
  try {
    const a = join(directory, 'a')
    const b = join(directory, 'b')
    await mkdir(a)
    await mkdir(b)
    const recent = new RecentWorkspaces(join(directory, 'settings', 'recent-workspaces.json'))
    assert.deepEqual(await recent.list(), [], 'no file yet means no recent workspaces')
    await recent.add(a)
    await recent.add(b)
    await recent.add(a)
    assert.deepEqual((await recent.list()).map((item) => item.name), ['a', 'b'])
    assert.equal(await recent.includes(b), true)
    assert.equal(await recent.includes(join(directory, 'elsewhere')), false, 'only recorded paths can be reopened')
    await rm(b, { recursive: true })
    assert.deepEqual((await recent.list()).map((item) => item.available), [true, false])
    await recent.remove(b)
    assert.deepEqual((await recent.list()).map((item) => item.path), [a])
    for (let index = 0; index < 12; index++) { await mkdir(join(directory, `w${index}`)); await recent.add(join(directory, `w${index}`)) }
    assert.equal((await recent.list()).length, 8, 'the list stays short')
    await writeFile(join(directory, 'settings', 'recent-workspaces.json'), 'not json')
    assert.deepEqual(await recent.list(), [], 'a damaged list is treated as empty')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
