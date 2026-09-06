# Autoform-Panel (`worker` branch)

![ci](https://github.com/lyp04/autoform-panel/actions/workflows/ci.yml/badge.svg)
![license](https://img.shields.io/badge/license-MIT-blue.svg)

The Cloudflare Workers deployment of the Autoform panel. The application code here matches the
`server` branch — this branch just wires it to the Workers platform instead of a Node process, so
pick the branch for where you run it.

The hosts are not interchangeable when it comes to release evidence: they can prove different
things about a deployment, and this branch can prove one thing `server` cannot. See
[What each branch can prove](#what-each-branch-can-prove).

## What each branch can prove

`autoform-kit`'s release chain requires live evidence about the deployment serving the app. Its
private release evidence verifier takes a `catalogAuthority` whose `type` selects which set of
checks must hold.

| | `worker` branch (this one) | `server` branch |
|---|---|---|
| Catalog authority `type` | `r2` or `github` | `self-hosted` |
| Located by | `wrangler`, via account id and worker name | the store path, service user and systemd unit |
| Catalog store | an R2 bucket or a private GitHub repository | a directory on the same host |
| Store is private | the bucket or repository is private | no access for others; group access only for the service user's own primary group |
| Running code is the reviewed code | Cloudflare's Worker version id | `SOURCE_COMMIT` plus a digest of the served files |
| Store is a separate system from the code serving it | **yes** — compromising the Worker does not hand over the catalog store | **no** — one host, one process, one user |

That last row is why this branch is the stronger deployment for release purposes: the catalog
store is a different system, reached over the network with its own credentials, so the evidence
report carries `catalogAuthoritySeparated`. A self-hosted panel cannot demonstrate that at all —
the process answering `/catalog/*` is also the process that can rewrite the store — so the report
omits the check there rather than reporting it true.

Identity differs the same way. The Worker version id this branch reports is assigned by
Cloudflare, so it is witnessed by someone other than the deployment; the `server` branch reports
a digest computed by the process that also serves the catalog, which shows internal consistency
but is not an independent attestation. `/api/runtime-provenance` reports
`provenance: "cloudflare_version_tag"` here and `"self_hosted_source_commit"` there, and the
verifier requires the runtime shape to match the declared authority type in both directions.

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

[MIT](./LICENSE)
