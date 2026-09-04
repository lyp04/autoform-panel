# Security Policy

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue for a
suspected vulnerability.

Email `admin@lyp04.com` with:

- a description of the issue and its impact,
- the steps to reproduce it,
- the version, branch, or commit you tested against.

We will acknowledge your report, investigate, and let you know when a fix is
available. Please give us reasonable time to release a fix before disclosing
the issue publicly.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

## Handling secrets

The panel handles secret material:

- a catalog read key that the mobile app uses to read the published catalog,
- an app-pairing issuer key (an HMAC secret) used to sign one-time pairing
  tickets.

Both live in `config/env`. That file must never be committed. It is listed in
`.gitignore` and `.dockerignore`; keep it that way. If a secret is ever
committed or otherwise exposed, rotate it: generate a new key, update
`config/env`, and restart the server. Rotating the pairing issuer key
invalidates any outstanding pairing tickets, and rotating the catalog read key
requires updating the clients that read the catalog.

Do not paste real keys into issues, pull requests, or logs.
