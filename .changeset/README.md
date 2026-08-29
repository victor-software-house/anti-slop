# Changesets

Create a changeset for every user-visible change:

```bash
bunx changeset
```

CI owns `changeset version`. CI publish is
`bun publish --access public --tolerate-republish` after an OIDC token
exchange. Do not run either locally.
