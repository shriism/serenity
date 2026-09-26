import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workspaceGraph } from '../src/shared/graph'

const entity = (id: string, body = '') => ({ id, title: id.toUpperCase(), type: 'thing', body })
const claim = (subject: string, value: string, status: 'confirmed' | 'retracted' = 'confirmed') =>
  ({ id: `${subject}-${value}`, subject, key: 'knows', value, source: 'Me', origin: 'human' as const, status, recordedAt: '' })

test('the graph links entities by confirmed claims and wikilinks, deterministically', () => {
  const snapshot = { pages: [], documents: [], entities: [entity('a', 'Met [[B]] and [[Nobody]].'), entity('b'), entity('c'), entity('d')],
    claims: [claim('a', 'b'), claim('b', 'c'), claim('c', 'd', 'retracted'), claim('a', 'not an entity')] }
  const graph = workspaceGraph(snapshot)
  assert.deepEqual(graph.edges.map((edge) => [edge.from, edge.to, edge.weight]).sort(), [['a', 'b', 2], ['b', 'c', 1]])
  assert.equal(graph.nodes.find((node) => node.id === 'b')?.degree, 3)
  assert.ok(graph.nodes.every((node) => node.x >= 0 && node.x <= 1 && node.y >= 0 && node.y <= 1))
  assert.deepEqual(workspaceGraph(snapshot).nodes, graph.nodes, 'the same workspace draws the same way')
  const limited = workspaceGraph(snapshot, new Set(['a', 'b', 'c', 'd']), 2)
  assert.deepEqual(limited.nodes.map((node) => node.id).sort(), ['a', 'b'])
  assert.equal(limited.hidden, 2)
  const started = performance.now()
  const big = { pages: [], documents: [], entities: Array.from({ length: 1000 }, (_, index) => entity(`e${index}`)),
    claims: Array.from({ length: 3000 }, (_, index) => claim(`e${index % 1000}`, `e${(index * 7) % 1000}`)) }
  assert.equal(workspaceGraph(big).nodes.length, 150)
  assert.ok(performance.now() - started < 1500, 'large workspaces draw a bounded graph quickly')
})
