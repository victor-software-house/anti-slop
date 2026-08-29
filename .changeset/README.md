# Changesets

Create a changeset for every user-visible change:

```bash
bunx changeset
```

CI owns `changeset version`. CI publish is `mise run release:oidc` then
`bun publish --access public --tolerate-republish`. Do not run either locally.
