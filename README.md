# Autoform-Panel (`worker` branch)

![ci](https://github.com/lyp04/autoform-panel/actions/workflows/ci.yml/badge.svg)
![license](https://img.shields.io/badge/license-MIT-blue.svg)

The Cloudflare Workers deployment of the Autoform panel. The application code here matches the
`server` branch — this branch just wires it to the Workers platform instead of a Node process, so
pick the branch for where you run it.

This branch tracks the panel from `lyp04/autoform-kit` (the commit is recorded in
`SOURCE_COMMIT`) and is deployed with Wrangler.

## Requirements

- A Cloudflare account with Workers, R2, and Durable Objects.
- Node.js and `wrangler` (`npm install` pulls it in as a dev dependency).

## Deploy

```sh
npm install
cp wrangler.example.toml wrangler.toml    # set your account id, route, and binding ids
npx wrangler deploy
```

Secrets are set out of band, never in `wrangler.toml`:

```sh
npx wrangler secret put CATALOG_READ_KEY
npx wrangler secret put APP_PAIR_ISSUER_KEY
npx wrangler secret put GITHUB_TOKEN        # only for the GitHub catalog store
npx wrangler secret put AI_API_KEY          # only if AI drafting is enabled
```

## Bindings

The platform provides four things the app needs. On the `server` branch these are the modules in
`stores/` instead.

| Binding | Service |
| --- | --- |
| `ASSETS` | Workers Static Assets (`./public`) |
| `CATALOG_R2` | an R2 bucket (catalog store) |
| `APP_PAIR_TICKETS` | a SQLite Durable Object (`AppPairingTicketStore`) |
| `CF_VERSION_METADATA` | injected by the platform |

Plain configuration variables (`PUBLIC_URL`, `BACKEND_API_BASE`, `APP_PAIR_APPLICATION_IDS`,
`CATALOG_STORAGE_MODE`, `AI_BASE_URL`, `AI_MODEL`, …) go in `wrangler.toml` under `[vars]`. They mean
the same as on the `server` branch — see that README for the full list.

## Layout

```
src/            worker.js ({ fetch, scheduled }) and the panel modules
public/         the single-page app
test/           node --test suite
wrangler.example.toml
SOURCE_COMMIT   the lyp04/autoform-kit commit this branch tracks
```

## Tests

```sh
npm test
```

## Updating from the kit

Copy `src/`, `public/`, `test/`, and the example configs from a checkout of `lyp04/autoform-kit`
at the desired commit, update `SOURCE_COMMIT`, and port the same change to the `server` branch if it
touches the application (not just the Worker shell).

## License

TODO
