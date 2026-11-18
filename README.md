# PGMMV Plugin Template

[![CI](https://github.com/kidthales/pgmmv-plugin-template/actions/workflows/ci.yml/badge.svg)](https://github.com/kidthales/pgmmv-plugin-template/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Self-contained ES5 starter template for [Pixel Game Maker MV (PGMMV)](https://rpgmakerofficial.com/product/act/en/manual/01_01.html) plugins, preconfigured with ESLint ES5 enforcement, `@kidthales/pgmmv-types` JSDoc type-checking, a `node:test` suite, and a comment-stripping `dist/` release bundler.

## Requirements

- Any current [Node.js](https://nodejs.org/en/download) LTS (Long-Term Support) version.
- A [Git](https://git-scm.com/) client.

## Quickstart ("Use this template")

1. Click **Use this template** -> **Create a new repository** on GitHub (or clone this repository directly), then clone your repository locally and install dependencies:

    ```bash
    git clone https://github.com/<your-username>/<your-plugin-repo>.git
    cd <your-plugin-repo>
    npm install
    ```

2. Update project and plugin metadata:
    - Set `name`, `version`, `description`, and `license` in `package.json`.
    - Update the `/**!` header banner (`@file`, `@author`, `@copyright`, `@license`, `@version`) and the `getInfo` fields (`name`, `description`, `author`, `help`) in `plugin.js`.
    - Update `LICENSE`, `README.md`, and `CHANGELOG.md` for your plugin.
3. Implement your plugin hooks in `plugin.js` and add unit tests in `tests/plugin.test.mjs`.
4. Verify formatting, ES5 compliance, JSDoc types, tests, and build output:

    ```bash
    npm run lint
    npm test
    npm run build
    ```

5. Import the generated `dist/<unscoped-name>-v<version>.js` file into PGMMV (**Plugins** -> **Add**).

## SpiderMonkey 33 & ES5 Constraints

PGMMV embeds **SpiderMonkey 33**, which executes plugins in an [ECMAScript 5.1](https://262.ecma-international.org/5.1/) script environment. `eslint.config.js` enforces `ecmaVersion: 5` and `sourceType: 'script'` on `plugin.js` with `Agtk`, `cc`, and `jsb` declared as read-only globals.

When editing `plugin.js`, follow these constraints:

- **Strict ES5 syntax only**: Use `var` and `function () {}` expressions. Avoid ES6+ features such as `let`/`const`, arrow functions, `class`, template literals, destructuring, default parameters, spread/rest syntax, `for...of`, and `import`/`export`.
- **IIFE return convention**: Wrap the plugin in `(function () { ... return plugin; })();` so PGMMV receives the plugin object on evaluation.
- **Editor-mode guard**: PGMMV evaluates `plugin.js` inside the editor (for example when calling `getInfo`) where runtime `Agtk` APIs may be absent. Guard runtime-only calls with an `isEditor()` check (`typeof Agtk === 'undefined' || !Agtk || typeof Agtk.log !== 'function'`).
- **Defensive `setParamValue` input check**: Guard `setParamValue(paramValue)` with `if (isEditor() || !Array.isArray(paramValue)) { return; }` before iterating parameters.
- **Banner preservation on build**: `scripts/build.mjs` strips JSDoc and line comments for clean PGMMV distribution while keeping `/**!` / `/*!` license banners intact and preserving ES5.1 §7.3 `LineTerminator` boundaries.

## JSDoc Typing with `@kidthales/pgmmv-types`

`tsconfig.json` enables `allowJs`, `checkJs`, `strict`, and `noEmit` with `@kidthales/pgmmv-types` so `tsc --noEmit` validates `plugin.js` without emitting ES6+ code.

1. Include the global ambient reference at the top of `plugin.js` to type `Agtk`, `cc`, and `jsb`:

    ```js
    /// <reference types="@kidthales/pgmmv-types/pgmmv.d.ts" />
    ```

2. Type the plugin object literal and hook parameters with JSDoc `import(...)` annotations:

    ```js
    /**
     * @type {import("@kidthales/pgmmv-types").AgtkPlugin}
     */
    var plugin = {
        /**
         * @param {import("@kidthales/pgmmv-types").AgtkPluginInfoCategoryValue} category
         */
        getInfo: function (category) {
            switch (category) {
                case 'name':
                    return 'My Plugin';
                case 'internal':
                    return {};
                default:
                    break;
            }
        },

        /**
         * @param {import("@kidthales/pgmmv-types").AgtkPluginInfoResult<'internal'>} [data]
         */
        initialize: function (data) {},

        /**
         * @param {import("@kidthales/pgmmv-types").AgtkParameterValue[]} paramValue
         */
        setParamValue: function (paramValue) {}
    };
    ```

3. For plugins that persist custom internal state, parameterize `AgtkPlugin<TInternal>` and `AgtkPluginInfoResult<'internal', TInternal>` via `@typedef`:

    ```js
    /**
     * @typedef {{ count: number }} PluginInternal
     * @type {import("@kidthales/pgmmv-types").AgtkPlugin<PluginInternal>}
     */
    ```

## Scripts Reference

| Script             | Command                                                | Purpose                                                                                                                                                                            |
| :----------------- | :----------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`     | `eslint --cache .`, `prettier --check`, `tsc --noEmit` | Verify ES5 compliance (`plugin.js`), ESM syntax (`scripts/**/*.mjs`, `tests/**/*.mjs`), Markdown/JSON/YAML formatting, and strict JSDoc types.                                     |
| `npm run lint-fix` | `eslint --cache --fix .`, `prettier --write`           | Auto-fix ESLint and Prettier formatting issues across source and documentation files.                                                                                              |
| `npm test`         | `node --test`                                          | Run the `tests/plugin.test.mjs` suite (plugin hook behavior, boundary guards, `scripts/build.mjs` path-containment and comment-stripping tests, and negative ESLint/`tsc` checks). |
| `npm run build`    | `node scripts/build.mjs`                               | Strip non-banner comments from `plugin.js`, format with Prettier, and emit `dist/<unscoped-name>-v<version>.js` (accepts an optional output path strictly inside `dist/`).         |

## References & License

- [Changelog](./CHANGELOG.md)
- [MIT License](./LICENSE)
- [@kidthales/pgmmv-types](https://github.com/kidthales/pgmmv-types)
- [PGMMV Plug-in Specifications](https://rpgmakerofficial.com/product/act/en/manual/Plug-in_Spec_en.pdf)
