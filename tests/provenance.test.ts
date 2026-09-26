import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../src/main/workspace'
import { citesDocument, documentKnowledge } from '../src/shared/provenance'

test('a document source may carry a location but must name the document', () => {
  assert.equal(citesDocument('syllabus.pdf', 'syllabus.pdf'), true)
  assert.equal(citesDocument('syllabus.pdf, p. 2', 'syllabus.pdf'), true)
  assert.equal(citesDocument('syllabus.pdf (week 3)', 'syllabus.pdf'), true)
  assert.equal(citesDocument('syllabus.pdf.bak', 'syllabus.pdf'), false)
  assert.equal(citesDocument('old syllabus.pdf', 'syllabus.pdf'), false)
  assert.equal(citesDocument(undefined, 'syllabus.pdf'), false)
})

test('a document lists the knowledge recorded from it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serenity-provenance-'))
  try {
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const course = (await workspace.saveEntity({ id: '', title: 'CS 101', type: 'course', body: '', source: 'syllabus.pdf' })).entities[0]
    await workspace.addClaim({ subject: course.id, key: 'midterm', value: 'October 12', source: 'syllabus.pdf, p. 2' })
    await workspace.addClaim({ subject: course.id, key: 'room', value: 'B12', source: 'Email from registrar' })
    await workspace.saveTask({ id: '', title: 'Read chapter 1', completed: false, notes: '', relatedEntityIds: [course.id], source: 'syllabus.pdf' })
    const knowledge = documentKnowledge(await workspace.snapshot(), 'syllabus.pdf')
    assert.deepEqual(knowledge.about.map(({ entity, claims }) => [entity.title, claims.map((claim) => claim.key)]), [['CS 101', ['midterm']]])
    assert.deepEqual(knowledge.created.map((entity) => entity.title), ['CS 101'])
    assert.deepEqual(knowledge.tasks.map((task) => task.title), ['Read chapter 1'])
    workspace.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
