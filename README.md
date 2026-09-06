# Autoform-Panel

![ci](https://github.com/lyp04/autoform-panel/actions/workflows/ci.yml/badge.svg)
![license](https://img.shields.io/badge/license-MIT-blue.svg)
![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)

Self-hosted deployment of the Autoform panel: a backend-gated tool for authoring form profiles and
publishing them as a versioned catalog that a mobile app reads. It also issues the one-time tickets
the app uses to pair with the catalog.

The repository has one branch per deployment target. The application code is the same on both; only
the host around it differs.

- **`server`** (this branch) — a plain Node.js process. No Cloudflare, no build step, no npm
  dependencies (it uses `node:sqlite`, `node:crypto`, `node:http`).
- **`worker`** — the Cloudflare Workers deployment. See that branch's README.

The hosts are not interchangeable when it comes to release evidence: they can prove different
things about a deployment. See [What each branch can prove](#what-each-branch-can-prove).

## Where the code comes from

`api/` and `test/` are generated from [autoform-kit](https://github.com/lyp04/autoform-kit), which is
the source of truth for the panel itself. Only the host around it — `server.mjs`, `stores/`,
`config/`, `nginx/`, `backup/` — is maintained in this repository.

To change the panel, change it in the kit, then resync here:

```sh
node tools/sync-from-kit.mjs --kit ../autoform-kit   # writes api/, test/, config/*.example.json
git diff                                             # review, then commit
```

`SOURCE_COMMIT` pins the upstream commit this repo is synced to, and CI runs the same script with
`--check` against it — so editing `api/` by hand shows up as drift instead of silently forking.
Ten of the kit's tests read its Android `app/` tree; those are skipped here and run in the kit's CI.

## Requirements

- Node.js 22 or newer.
- A reverse proxy (nginx, Caddy, …) terminating TLS in front of it. A sample nginx vhost is in
  `nginx/`.

## Quick start

```sh
git clone <this-repo> autoform-panel
cd autoform-panel
cp config/env.example config/env      # edit: set at least PUBLIC_URL and CATALOG_READ_KEY
node server.mjs
```

By default it listens on `127.0.0.1:18788` and keeps its data under `./data`. Check it:

```sh
curl -s localhost:18788/__host/health
```

### Running as a service

Everything the deployment needs lives in the project directory, so you can keep the whole thing in
one place and symlink the system paths to it:

```sh
sudo ln -s "$PWD/config/autoform-panel.service" /etc/systemd/system/autoform-panel.service
sudo ln -s "$PWD/nginx/autoform-panel.conf"     /etc/nginx/sites-enabled/autoform-panel.conf
sudo systemctl daemon-reload && sudo systemctl enable --now autoform-panel
```

## Configuration

Settings are read from an env file (`KEY=value`, no shell interpolation). The path is
`AUTOFORM_ENV_FILE`, defaulting to `config/env`. `config/env.example` is a template.

### Server

| Variable | Default | Description |
| --- | --- | --- |
| `LISTEN_HOST` | `127.0.0.1` | Address to bind. Keep it on loopback and put a proxy in front. |
| `LISTEN_PORT` | `18788` | Port to bind. |
| `DATA_DIR` | `./data` | Where the catalog and pairing database are stored. |
| `PUBLIC_URL` | — (required) | The public origin, e.g. `https://panel.example.com`. Pairing and the catalog proof are bound to it. |

### Catalog store

The published catalog lives under `DATA_DIR/catalog` as a content-addressed store: immutable
snapshots plus a `catalog-current-v1.json` pointer that moves under a compare-and-set. A fresh
install is seeded from `config/seed-catalog` on first run, and `backup/backup.sh` archives the
whole of `data/` daily (see `config/autoform-panel-backup.timer`).

### Access control

| Variable | Default | Description |
| --- | --- | --- |
| `CATALOG_READ_KEY` | — | Bearer key the app sends to read the catalog. **If empty, catalog reads are public** — always set it in production. |
| `APP_PAIR_ISSUER_KEY` | — | Server-to-server key that authorizes pairing-ticket issuance. Must be ≥ 32 chars and different from `CATALOG_READ_KEY`. |
| `APP_PAIR_APPLICATION_IDS` | — | Comma-separated app IDs allowed to pair, e.g. `com.example.app`. |
| `APP_PAIR_TTL_SECONDS` | `300` | Ticket lifetime, 60–600. |

### Backend (the system operators log in to)

| Variable | Default | Description |
| --- | --- | --- |
| `BACKEND_API_BASE` | — | Base URL of the backend the panel authenticates against, e.g. `https://api.example.com/api`. |
| `BACKEND_ADAPTER_JSON` | — | Optional inline adapter config (JSON). Overrides the catalog's stored adapter. |
| `BACKEND_SESSION_PROOF_CODES` | — | Optional list of session-proof codes. |

### AI drafting (optional)

Leave these unset to disable the AI draft/translate features.

| Variable | Default | Description |
| --- | --- | --- |
| `AI_BASE_URL` | — | An OpenAI-compatible endpoint, e.g. `https://your-llm-endpoint/v1`. |
| `AI_MODEL` | — | Model id, e.g. `your-model`. |
| `AI_API_KEY` | — | API key for the endpoint. |

### Provenance

`/api/runtime-provenance` reports which deployment is running. On this branch it is built from
`SOURCE_COMMIT` and a digest of the files actually served, and reports
`provenance: "self_hosted_source_commit"`. On the `worker` branch it comes from Cloudflare's
version metadata binding and reports `provenance: "cloudflare_version_tag"` with the Worker
version id.

`VERSION_ID`, `VERSION_TAG` and `VERSION_TIMESTAMP` are only read when there is no deployed
source tree to derive provenance from; on this branch they are unused. Do not carry them over
from a previous Cloudflare deployment — a stale `VERSION_ID` makes the panel claim a Worker that
no longer serves anything.

## What each branch can prove

`autoform-kit`'s release chain requires live evidence about the deployment serving the app, and
the two branches do not satisfy it the same way. The kit's private release evidence verifier
takes a `catalogAuthority` whose `type` selects which set of checks must hold.

| | `worker` branch | `server` branch (this one) |
|---|---|---|
| Catalog authority `type` | `r2` or `github` | `self-hosted` |
| Located by | `wrangler`, via account id and worker name | the store path, service user and systemd unit |
| Catalog store | an R2 bucket or a private GitHub repository | a directory on the same host |
| Store is private | the bucket or repository is private | no access for others; group access only for the service user's own primary group; no setuid/setgid/sticky |
| Running code is the reviewed code | Cloudflare's Worker version id | `SOURCE_COMMIT` plus a digest of the served files |
| Store is a separate system from the code serving it | **yes** — compromising the Worker does not hand over the catalog store | **no** — one host, one process, one user |

That last row is the real difference, and it is a reduction, not a formality. On `worker` the
catalog store is a different system reached over the network with its own credentials. On
`server` the process that answers `/catalog/*` is also the process that can read and rewrite the
store, running as the user that owns it. There is no isolation left to demonstrate, so the
evidence report omits `catalogAuthoritySeparated` for a self-hosted deployment rather than
reporting it as true, and carries `catalogStorePrivateOnDisk` instead — what a directory can
actually demonstrate. `publish-release.sh` requires whichever exact shape matches the declared
authority type.

The other difference is what identifies the deployment. A Worker version id is assigned by
Cloudflare, so it is witnessed by someone other than the deployment. The tree digest on this
branch is computed by the same process that serves the catalog, so it shows the deployment is
internally consistent and matches a known commit — useful for binding a release to what is
actually deployed, but not an independent attestation. The contract names it
`self_hosted_source_commit` so the two are never mistaken for each other, and the verifier
requires the runtime shape to match the declared authority type in both directions.

## Layout

```
server.mjs        process entry: HTTP server, wiring, graceful shutdown
api/              the application
  request-handler.mjs   the whole request pipeline
  env.mjs               env-file loader
  *.js                  profiles, catalog, backend adapter, pairing, AI, …
public/           the single-page app
stores/           local implementations of the three services the app needs
  static-assets.mjs     serves public/
  catalog-bucket.mjs    content-addressed catalog store on the filesystem
  pairing-store.mjs     one-time pairing tickets in SQLite
config/           env.example and the systemd unit
nginx/            sample vhost
backup/           daily data backup script
data/             runtime state (catalog, pairing.sqlite) — not in version control
```

## How it works

`server.mjs` accepts a request, hands it to `api/request-handler.mjs`, and writes back the response.
The handler gates catalog reads with `CATALOG_READ_KEY`, gates authoring behind a backend session,
and validates every profile before publishing a new immutable catalog version. The mobile app reads
`/api/config` and `/catalog/*`, and pairs through `/api/app-pair/v1/{issue,redeem}`.

The three `stores/` modules are what the Workers version gets from the platform (static assets, an
object store, a durable single-writer). Here they are ordinary files and a SQLite database, so the
process is self-contained.

## Endpoints

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/panel-config` | none |
| GET | `/api/config` | read key |
| GET | `/api/runtime-provenance` | read key |
| GET | `/catalog/*` | read key |
| GET | `/api/profiles` | read key or backend session |
| GET | `/api/me` | backend session |
| POST | `/api/convert` | backend session |
| POST | `/api/ai/draft` | backend session |
| POST | `/api/publish` | backend session |
| POST | `/api/settings` | backend session |
| POST | `/api/notify` | per notification adapter |
| POST | `/api/app-pair/v1/issue` | issuer key |
| POST | `/api/app-pair/v1/redeem` | one-time ticket |
| GET | `/*` | none (SPA) |

## License

[MIT](./LICENSE)
