# Contributing to Autoform-Panel

Thanks for your interest in the project. This document covers how to get the
panel running locally, how to run the tests, and what we expect from pull
requests.

## What this is

Autoform-Panel is a backend-gated web panel for authoring form profiles and
publishing them as a versioned catalog that a mobile app reads. It also issues
one-time app-pairing tickets. It targets Node.js 22.

## Getting set up

```
git clone <your fork or the upstream repository>
cd autoform-panel
cp config/env.example config/env
node server.mjs
```

Edit `config/env` before starting the server. It holds the catalog read key
and the app-pairing issuer key, so treat it as a secrets file and never commit
it. See `SECURITY.md`.

Runtime data (the SQLite database and anything else the panel writes) lives in
`data/`. That directory is created on first run and is not tracked in git.

The server branch has no npm dependencies. It uses the built-in `node:sqlite`,
`node:crypto`, and `node:http` modules, so there is no install step. If you
find yourself reaching for a package, raise it in an issue first.

## Running tests

```
node --test
```

Add tests for behaviour you change or add. Keep them runnable with the built-in
test runner so the no-dependency rule still holds.

## The two branches

The project ships from two long-lived branches that hold the same application:

- `server` is the native Node.js deployment. It is the main branch and the one
  most contributions start from. Entry point is `server.mjs`.
- `worker` is the Cloudflare Workers deployment of the same app. It adapts the
  storage and request handling to the Workers runtime but keeps the same
  behaviour and the same profile/catalog/pairing logic.

When you change application code that both branches share (profile authoring,
catalog publishing, pairing tickets, validation, the HTTP surface), you are
expected to land the equivalent change on both branches. A feature that only
exists on one branch is a bug waiting to happen.

## Pull requests

- Keep changes focused. One topic per PR.
- Describe what changed and why in the PR body.
- State whether the change touches shared app code and, if so, that the
  `server` and `worker` branches are in sync.
- Note any change to `config/env.example` or to the shape of stored data.
- Make sure `node --test` passes before you open the PR.

If you are planning something large, open an issue first so we can agree on the
approach before you write the code.
