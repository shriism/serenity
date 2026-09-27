import { test } from 'node:test'
import assert from 'node:assert/strict'
import { externalLink } from '../src/shared/external-links'

test('only web and email links may leave the app', () => {
  assert.equal(externalLink('https://example.com/a?b=1'), 'https://example.com/a?b=1')
  assert.equal(externalLink('mailto:alex@example.com'), 'mailto:alex@example.com')
  for (const refused of ['file:///etc/passwd', 'javascript:alert(1)', 'serenity:entity/x', 'smb://host/share', 'http://', 'not a url', 42, 'https://' + 'a'.repeat(3000)])
    assert.equal(externalLink(refused), null, String(refused).slice(0, 40))
})
