# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [0.1.0] - 2026-09-04

### Added

- Backend-gated panel for authoring form profiles.
- Versioned catalog publishing for the mobile app to read, protected by a
  catalog read key.
- One-time app-pairing tickets signed with an HMAC issuer key.
- Native Node.js 22 server (`server.mjs`) using `node:sqlite`, `node:crypto`,
  and `node:http`, with no npm dependencies.
- Configuration via `config/env` (template in `config/env.example`) and runtime
  data stored in `data/`.
- Cloudflare Workers deployment of the same app on the `worker` branch.

[Unreleased]: https://panel.example.com/compare/v0.1.0...HEAD
[0.1.0]: https://panel.example.com/releases/tag/v0.1.0
