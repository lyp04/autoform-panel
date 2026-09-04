# autoform-panel

Backend-gated panel for authoring AutoForm Kit form profiles and publishing them to a catalog that
the Android App consumes (`manifest.json` → `form-profiles.json`, SHA-256 verified), plus the
app-pairing issue/redeem endpoints.

The application code (`src/panel/`) is the AutoForm Kit panel, written in **standard, portable
JavaScript** — it uses the Web platform APIs (`Request`, `Response`, `Headers`, `crypto.subtle`,
`URL`, streams) that both Cloudflare Workers **and** Node.js 22+ implement natively. Because of that,
the exact same panel code can be deployed two ways.

---

## Two deployment methods

### Method A — Cloudflare Worker (upstream `lyp04/autoform-kit`)

The panel originated as a Cloudflare Worker. In that form the platform provides the four services the
panel needs as Worker **bindings**, configured in `wrangler.toml`:

| Binding | Cloudflare service |
|---|---|
| `ASSETS` | Workers Static Assets (`./public`) |
| `CATALOG_R2` | an R2 bucket |
| `APP_PAIR_TICKETS` | a SQLite Durable Object |
| `CF_VERSION_METADATA` | injected by the platform |

Deploy with `wrangler deploy` from the upstream repo. Secrets (`AI_API_KEY`, `APP_PAIR_ISSUER_KEY`,
`CATALOG_READ_KEY`, `GITHUB_TOKEN`, …) are set with `wrangler secret put`. This is the right choice if
you want Cloudflare's edge, autoscaling and managed storage.

### Method B — native Node server (this repo)

For a fixed server (no Cloudflare dependency), this repo runs the identical panel code on plain
**Node.js 22+**. It has **no npm dependencies** — everything is Node built-ins (`node:http`,
`node:sqlite`, `node:crypto`, `node:fs`). The four Worker bindings are provided by small, first-class
native modules in `src/stores/`:

| Binding | Native module (`src/stores/`) | Backing store |
|---|---|---|
| `ASSETS` | `static-assets.mjs` | files under `src/panel/public/` |
| `CATALOG_R2` | `catalog-bucket.mjs` | content-addressed files under `data/catalog/` (R2-accurate MD5 ETags, atomic writes, per-key CAS) |
| `APP_PAIR_TICKETS` | `pairing-store.mjs` | `data/pairing.sqlite` (single-writer, atomic one-time tickets, TTL cleanup) |
| `CF_VERSION_METADATA` | — | read from the env file |

`src/server.mjs` is an ordinary Node HTTP server: it builds a Web `Request` from the incoming Node
request, calls `handleRequest(request, bindings)` (`src/panel/request-handler.mjs`), and streams the
returned Web `Response` back out.

#### Run

```bash
# 1) config + secrets
cp config/env.example /etc/autoform-panel/env   # then fill in the values

# 2) start (listens on 127.0.0.1:18788 by default; front it with nginx + TLS)
AUTOFORM_ENV_FILE=/etc/autoform-panel/env node src/server.mjs

# health
curl -s http://127.0.0.1:18788/__host/health
```

Run it under systemd (unit in `config/`) behind an nginx reverse proxy that terminates TLS.

#### Layout

```
src/
  server.mjs                 native HTTP server + graceful shutdown (Method B entry point)
  config.mjs                 dotenv-style env-file loader
  panel/                     the panel application (portable Web-API code; same as upstream)
    request-handler.mjs      handleRequest(request, bindings) — the whole HTTP pipeline
    app-pairing.js           issue/redeem endpoints (HMAC, one-time tickets, rate limiting)
    catalog.js               catalog read/publish (versioning, SHA-256, CAS)
    profile.js backend-adapter.js backend.js ai.js convert.js translate.js
    notification-adapter.js update-source.js panel-runtime.js daily-stats.js
    public/                  the SPA
  stores/                    native implementations of the four Worker bindings (Method B only)
data/
  catalog/                   published catalog (content-addressed snapshots + current pointer)
  pairing.sqlite             app-pairing ticket store
```

---

## Endpoints (both methods, identical behavior)

| Method | Path | Auth |
|---|---|---|
| GET | `/api/panel-config` | none (browser bootstrap) |
| GET | `/api/config` | catalog read key (App) |
| GET | `/api/runtime-provenance` | catalog read key |
| GET | `/catalog/*` | catalog read key |
| GET | `/api/profiles` | read key **or** backend session |
| GET | `/api/me` | backend session |
| POST | `/api/convert` | backend session |
| POST | `/api/ai/draft` | backend session |
| POST | `/api/publish` | backend session |
| POST | `/api/settings` | backend session |
| POST | `/api/notify` | per notification adapter |
| POST | `/api/app-pair/v1/issue` | issuer bearer key |
| POST | `/api/app-pair/v1/redeem` | one-time ticket |
| GET | `/*` | none (static SPA) |

> **Security note:** if `CATALOG_READ_KEY` is empty, catalog reads (`/api/config`, `/catalog/*`,
> `/api/runtime-provenance`) become fully public. Always set it in production.
