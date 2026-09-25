export const defaultHome = `---
id: home
title: Home
kind: page
---
# Your world, in context

This page is yours. Edit its words, reorder its sections, or write a different one. Live lists below come from files in this workspace.

## Coming up

\`\`\`serenity-query
from: upcoming
limit: 6
\`\`\`

## Worth a look

\`\`\`serenity-query
from: proposals
where:
  status: pending
limit: 5
\`\`\`

## Recent knowledge

\`\`\`serenity-query
from: claims
where:
  status: confirmed
sort: recordedAt
limit: 5
\`\`\`

[Add knowledge](serenity:command/entity.create) · [Create a page](serenity:command/page.create) · [Open documents](serenity:command/view.documents)
`
