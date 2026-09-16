# publish-vsix agent guide

This repository is a composite GitHub Action. It publishes an existing VSIX
through the official `@vscode/vsce` and `ovsx` clients. There is no build step
or bundled JavaScript artifact.

- `action.yml` owns runtime setup and input/output wiring. Pass inputs through
  environment variables, never interpolate them into shell commands.
- `src/publish.mjs` owns validation and independent registry attempts. Open VSX
  returns settled results; a rejected result must fail publication.
- `src/retry.mjs` owns transient-error classification and bounded backoff. Retry
  the whole client call with a fresh stream. Preserve duplicate handling because
  an upload can succeed before the client times out.
- `test/` uses stubs and local HTTP servers. Never add tests that publish to a
  real registry or require secrets. Keep Windows path and process behavior
  covered by the CI matrix.

Run `npm ci --ignore-scripts`, then `npm run check`. Also run `actionlint`,
`shellcheck scripts/update-tags.sh`, `shfmt -d scripts/update-tags.sh`,
`panache format --check .`, and `panache lint .`. Panache is provided by the
user environment; the other development tools are in `devenv.nix`.

Generate `package-lock.json` with npm and `devenv.lock` with devenv. Keep client
updates covered by the integration tests. Versionary owns `version.txt` and
`CHANGELOG.md`; do not edit the changelog manually. Release tags and floating
major/minor tags are managed by workflows.
