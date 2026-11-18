# Changelog

All notable changes to `@kidthales/pgmmv-plugin-template` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-18

Modernizes the template for PGMMV's SpiderMonkey 33 (ES5.1) runtime with strict `@kidthales/pgmmv-types` JSDoc checking, a canonical `scripts/build.mjs` release pipeline, expanded `node:test` coverage, and self-contained documentation.

### Added

- **GitHub Actions CI workflow (`.github/workflows/ci.yml`) (`#63`, `#71`)**: Restored CI with least-privilege `contents: read` permissions running `npm run lint`, `npm test`, and `npm run build` on `main` and Epic branches.
- **Strict JSDoc type-checking (`tsconfig.json`, `plugin.js`) (`#63`, `#71`)**: Enabled `allowJs`, `checkJs`, and `strict` with `@kidthales/pgmmv-types@^0.2.1` and standardized `AgtkPlugin` JSDoc annotations in `plugin.js`.
- **Canonical release bundler (`scripts/build.mjs`, `npm run build`) (`#71`)**: Added `buildPlugin` and `stripComments` to emit Prettier-formatted `dist/<unscoped-name>-v<version>.js` bundles while preserving `/**!` / `/*!` license banners, enforcing `fs.realpathSync` self-overwrite and `dist/` containment guards, preserving ES5.1 §7.3 `LineTerminator` boundaries, and rescanning template literal braces and regex literals.
- **Expanded `node:test` verification (`tests/plugin.test.mjs`) (`#71`)**: Added tests covering all `AgtkPlugin` hooks, `isEditor()` and `setParamValue` boundary inputs, `scripts/build.mjs` path-containment and comment-stripping invariants, ESLint ES5 syntax rejection, and `tsc --noEmit` negative type-checking.
- **Self-contained template documentation (`README.md`, `CHANGELOG.md`) (`#71`)**: Replaced the stub `README.md` with CI/license badges, a `"Use this template"` quickstart, SpiderMonkey 33 / ES5 constraints, `@kidthales/pgmmv-types` JSDoc patterns, npm script reference, and this Keep-a-Changelog history.

### Changed

- **Package & toolchain alignment (`package.json`, `eslint.config.js`, `.prettierignore`, `.github/dependabot.yml`) (`#63`, `#71`)**: Updated `@kidthales/pgmmv-plugin-template` to `0.2.0`, updated `devDependencies` (`@kidthales/pgmmv-types@^0.2.1`, ESLint 9, Prettier 3, TypeScript 7, `concurrently` 10), ignored `**/.tmp-*/**`, `scripts/**/*.mjs`, and `.ci-local` appropriately, and configured quarterly non-major Dependabot updates.
- **Plugin license banner (`plugin.js`) (`#71`)**: Added a `/**!` `@file`/`@version 0.2.0`/`@license` header banner preserved by `scripts/build.mjs`.

### Fixed

- **Defensive `setParamValue` guard (`plugin.js`) (`#71`)**: Guarded `plugin.setParamValue` against nullish and non-array `paramValue` inputs when executing outside the PGMMV editor.
