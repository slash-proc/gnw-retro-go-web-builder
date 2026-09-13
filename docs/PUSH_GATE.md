# Push gate

Before pushing a change, run:

```sh
npm run check:push
```

This is an honor-system gate, not a Git hook. It runs the same production checks as the Pages
workflow: whitespace validation, internal package builds, and the complete `@gnw/web` production
build. Do not push a change if this command fails.
