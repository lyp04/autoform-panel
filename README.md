# autoform-panel — `worker` branch (Cloudflare Worker deployment)

This branch is the AutoForm Kit panel in its **Cloudflare Worker** form: the upstream
`lyp04/autoform-kit` panel, pinned at commit `98caef755e7c469e210e9cc7651cc7a3df997a3d`
(see `SOURCE_COMMIT`). It is byte-for-byte the upstream `panel/` and is deployed with `wrangler`.

> The **`server`** branch of this repo is the same application deployed as a plain Node.js 22 server
> (no Cloudflare). Pick the branch that matches where you're running it. The application code is the
> same portable Web-API code on both branches; only the deployment shell differs.

## Deploy

```bash
npm install
cp wrangler.example.toml wrangler.toml     # fill in account id, routes, binding ids
npx wrangler deploy
# secrets (never in wrangler.toml):
npx wrangler secret put AI_API_KEY
npx wrangler secret put APP_PAIR_ISSUER_KEY
npx wrangler secret put CATALOG_READ_KEY
npx wrangler secret put GITHUB_TOKEN
```

## Platform bindings (provided by Cloudflare)

| Binding | Service |
|---|---|
| `ASSETS` | Workers Static Assets (`./public`) |
| `CATALOG_R2` | R2 bucket (catalog store) |
| `APP_PAIR_TICKETS` | SQLite Durable Object (`AppPairingTicketStore`) |
| `CF_VERSION_METADATA` | injected by the platform |

On the `server` branch these four are provided by small native modules in `stores/` instead.

## Layout (this branch)

```
src/            worker.js ({ fetch, scheduled }) + panel modules
public/         SPA
test/           node --test suite (247 tests)
wrangler.example.toml   template wrangler config
package.json    (wrangler devDependency)
SOURCE_COMMIT   upstream lyp04/autoform-kit commit this tracks
```

## Updating from upstream

```bash
# in a checkout of lyp04/autoform-kit at the desired commit:
#   copy panel/{src,public,test,package.json,*.example.*} over this branch,
#   update SOURCE_COMMIT, then port the same change onto the `server` branch if needed.
```
