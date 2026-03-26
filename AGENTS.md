# AGENTS.md

Purpose: architecture-specific instructions for coding agents working in vide-component-transcriptions.

This file extends and overrides the repository root AGENTS.md for this submodule.

## Scope

Applies to all files under this directory.

## Architecture Overview

Core structure:
- src/index.js: component entry and custom element registration.
- src/vide-transcr.js: root container custom element.
- src/vide-transcr-router.js: History API routing, document loading, and writing-zone view orchestration.
- src/vide-transcr-content.js: content wrapper abstraction.
- src/vide-transcr-panels.js: OpenSeadragon panel rendering and synchronized viewport behavior.
- src/data-cache.js: shared fetch promise cache.

Design characteristics:
- SPA island model under /transcr routes.
- Dynamic script loading for OpenSeadragon global availability.
- Multi-panel rendering with panel synchronization and overlay logic.

## Change Strategy

When making changes, preserve separation of concerns:
- Route parsing and navigation control in vide-transcr-router.js.
- Rendering primitives and viewer sync logic in vide-transcr-panels.js.
- Keep wrapper element responsibilities minimal in vide-transcr-content.js and vide-transcr.js.

Avoid embedding large rendering logic in router when it belongs in reusable panel/helper modules.

## JavaScript Standard

- StandardJS-compliant code is required.
- Use ESLint Standard configuration for lint checks.
- Keep exported/public APIs documented with JSDoc.

## Local Asset Hosting Policy

- Use locally hosted assets for runtime dependencies.
- Do not add CDN references for JavaScript, CSS, fonts, icons, or image assets.
- Prefer npm-managed dependencies that are bundled with the component build, or vendored static files inside the repository.
- Any temporary external asset URL requires explicit user approval and a documented follow-up to remove it.

## Test Harness Policy

This submodule must use Vitest with happy-dom (aligned with vide-component-facsimile).

When adding or changing behavior:
- Add or update tests in a tests/ directory.
- Prioritize unit tests for parser/data and integration tests for route/view behavior.

## Required Validation Commands

Once test/lint scripts exist, agents must run all of:
- npm run lint
- npm run test
- npm run test:coverage

Until fully bootstrapped, agents should still run any available checks and report gaps explicitly.

## Coverage And Test Rules

- Coverage threshold target: >= 80% lines/functions/branches.
- New features require tests by default.
- Existing tests must be updated when behavior changes.

## Implementation Notes

- Use data-cache.js for shared request deduplication.
- Preserve URL behavior and path restoration from 404 redirect parameters.
- Keep OpenSeadragon-specific assumptions localized to panel logic.
- Avoid introducing hidden global state beyond the current explicit window-level integration points.

## Completion Checklist

Before finalizing changes in this submodule:
- Lint passed.
- Impacted tests passed.
- Full suite passed.
- Coverage checked against threshold.
- Public interfaces documented.
