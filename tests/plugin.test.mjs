import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { assertSafeOutputPath, buildPlugin, resolveRealPath, stripComments } from '../scripts/build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const pluginPath = path.join(ROOT, 'plugin.js');
const pluginSource = fs.readFileSync(pluginPath, 'utf8');
const buildScript = path.join(ROOT, 'scripts', 'build.mjs');
const eslintBin = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

function loadPlugin(context = {}) {
  return vm.runInNewContext(pluginSource, context, { filename: 'plugin.js' });
}

test('plugin.js evaluates to an object exposing all PGMMV plugin hooks', () => {
  const plugin = loadPlugin({});
  assert.equal(typeof plugin, 'object');
  assert.notEqual(plugin, null);

  for (const method of [
    'setLocale',
    'getInfo',
    'initialize',
    'finalize',
    'setParamValue',
    'setInternal',
    'call',
    'update',
    'execActionCommand',
    'execLinkCondition'
  ]) {
    assert.equal(typeof plugin[method], 'function', `Expected ${method} to be a function`);
  }
});

test('getInfo returns expected template values for all supported categories', () => {
  const plugin = loadPlugin({});

  assert.equal(plugin.getInfo('name'), 'PGMMV Plugin Template');
  assert.equal(plugin.getInfo('description'), 'PGMMV Plugin Template');
  assert.equal(plugin.getInfo('author'), 'Author Name');
  assert.equal(plugin.getInfo('help'), 'Plugin Help');
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.getInfo('parameter'))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.getInfo('internal'))), {});
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.getInfo('actionCommand'))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.getInfo('linkCondition'))), []);
});

test('initialize and setParamValue log through Agtk.log outside the editor', () => {
  const logs = [];
  const plugin = loadPlugin({
    Agtk: {
      log(message) {
        logs.push(message);
      }
    }
  });

  plugin.initialize({});
  plugin.setParamValue([
    { id: 1, value: 42 },
    { id: 2, value: 'ok' }
  ]);

  assert.deepEqual(logs, ['Initialize PGMMV Plugin Template', 'Parameter 1 = 42', 'Parameter 2 = ok']);
});

test('execLinkCondition returns false and no-op hooks complete without throwing', () => {
  const plugin = loadPlugin({});

  assert.equal(plugin.execLinkCondition(0, [], 1, 1, 1, 0), false);
  assert.doesNotThrow(() => {
    plugin.setLocale('en');
    plugin.setInternal({});
    plugin.call();
    plugin.update(16);
    plugin.execActionCommand(0, [], 1, 1, 1, 1, 0, 1);
    plugin.finalize();
  });
});

test('initialize and setParamValue do not throw ReferenceError when Agtk is unbound', () => {
  const plugin = loadPlugin({});

  assert.doesNotThrow(() => {
    plugin.initialize({});
    plugin.setParamValue([{ id: 1, value: 42 }]);
  });
});

test('initialize and setParamValue treat null or partial Agtk objects as editor mode', () => {
  for (const agtkCandidate of [null, undefined, {}, { log: 'not-a-function' }]) {
    const plugin = loadPlugin({ Agtk: agtkCandidate });
    assert.doesNotThrow(() => {
      plugin.initialize();
      plugin.setParamValue([{ id: 1, value: 'ignored' }]);
    });
  }
});

test('getInfo returns undefined for unknown categories', () => {
  const plugin = loadPlugin({});

  assert.equal(plugin.getInfo('invalid'), undefined);
  assert.equal(plugin.getInfo(''), undefined);
});

test('setParamValue with an empty array produces zero Agtk.log calls', () => {
  const logs = [];
  const plugin = loadPlugin({
    Agtk: {
      log(message) {
        logs.push(message);
      }
    }
  });

  plugin.setParamValue([]);
  assert.deepEqual(logs, []);
});

test('setParamValue ignores nullish, primitive, and array-like non-array inputs outside the editor', () => {
  const logs = [];
  const plugin = loadPlugin({
    Agtk: {
      log(message) {
        logs.push(message);
      }
    }
  });

  for (const boundary of [null, undefined, 0, 'invalid', true, {}, { length: 1, 0: { id: 1, value: 'x' } }]) {
    assert.doesNotThrow(() => {
      plugin.setParamValue(boundary);
    });
  }

  assert.deepEqual(logs, []);
});

test('setParamValue skips sparse, nullish, and primitive array entries without throwing', () => {
  const logs = [];
  const plugin = loadPlugin({
    Agtk: {
      log(message) {
        logs.push(message);
      }
    }
  });

  // eslint-disable-next-line no-sparse-arrays
  const sparse = [, { id: 3, value: 'sparse-ok' }];
  assert.doesNotThrow(() => {
    plugin.setParamValue([null, undefined, 42, 'bad', true, { id: 1, value: 'ok' }]);
    plugin.setParamValue(sparse);
  });

  assert.deepEqual(logs, ['Parameter 1 = ok', 'Parameter 3 = sparse-ok']);
});

test('scripts/build.mjs builds plugin.js preserving /**! banner and stripping JSDoc/line comments', () => {
  const distDir = path.join(ROOT, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const distTmpDir = fs.mkdtempSync(path.join(distDir, '.tmp-build-out-'));
  try {
    const outFile = path.join(distTmpDir, 'bundle.js');
    const result = spawnSync(process.execPath, [buildScript, outFile], {
      cwd: ROOT,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const built = fs.readFileSync(outFile, 'utf8');
    assert.match(built, /^\/\*\*![\s\S]*@version 0\.2\.0[\s\S]*\*\//);
    assert.doesNotMatch(built, /\/\/\/ <reference/);
    assert.doesNotMatch(built, /noinspection/);
    assert.doesNotMatch(built, /@param/);

    const plugin = vm.runInNewContext(built, {}, { filename: 'bundle.js' });
    assert.equal(plugin.getInfo('name'), 'PGMMV Plugin Template');
    assert.equal(plugin.execLinkCondition(0, [], 1, 1, 1, 0), false);
  } finally {
    fs.rmSync(distTmpDir, { recursive: true, force: true });
  }
});

test('buildPlugin emits default unscoped dist filename from package.json metadata', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmmv-build-fixture-'));
  try {
    fs.writeFileSync(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({ name: '@kidthales/sample-plugin', version: '1.2.3' }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempRoot, 'plugin.js'),
      '/**!\n * @license MIT\n */\n// strip me\n(function () { return {}; })();\n',
      'utf8'
    );

    const outPath = await buildPlugin({ rootDir: tempRoot, cwd: tempRoot });
    assert.equal(path.basename(outPath), 'sample-plugin-v1.2.3.js');
    assert.equal(path.dirname(outPath), path.join(tempRoot, 'dist'));

    const built = fs.readFileSync(outPath, 'utf8');
    assert.match(built, /@license MIT/);
    assert.doesNotMatch(built, /strip me/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('scripts/build.mjs enforces self-overwrite and dist/ containment guards including symlinks', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmmv-build-guards-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmmv-build-outside-'));
  try {
    const inputPath = path.join(tempRoot, 'plugin.js');
    const distDir = path.join(tempRoot, 'dist');
    fs.writeFileSync(inputPath, 'var x = 1;\n', 'utf8');
    fs.mkdirSync(distDir, { recursive: true });

    for (const target of [inputPath, path.join(distDir, '..', 'plugin.js')]) {
      assert.throws(
        () => assertSafeOutputPath({ rootDir: tempRoot, inputPath, distDir, outputPath: target }),
        /Refusing to overwrite input file/
      );
    }

    for (const target of [
      distDir,
      path.join(distDir, '.'),
      path.join(tempRoot, 'outside.js'),
      path.join(outsideDir, 'escape.js'),
      path.join(distDir, '..', 'outside.js')
    ]) {
      assert.throws(
        () => assertSafeOutputPath({ rootDir: tempRoot, inputPath, distDir, outputPath: target }),
        /Refusing to write outside dist directory/
      );
    }

    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
    const rootAliasInDist = path.join(distDir, 'root-alias');
    fs.symlinkSync(tempRoot, rootAliasInDist, symlinkType);
    assert.throws(
      () =>
        assertSafeOutputPath({
          rootDir: tempRoot,
          inputPath,
          distDir,
          outputPath: path.join(rootAliasInDist, 'plugin.js')
        }),
      /Refusing to overwrite input file/
    );

    const escapeLinkInDist = path.join(distDir, 'escape-link');
    fs.symlinkSync(outsideDir, escapeLinkInDist, symlinkType);
    assert.throws(
      () =>
        assertSafeOutputPath({
          rootDir: tempRoot,
          inputPath,
          distDir,
          outputPath: path.join(escapeLinkInDist, 'out.js')
        }),
      /Refusing to write outside dist directory/
    );

    const cliFail = spawnSync(process.execPath, [buildScript, '../outside.js'], {
      cwd: ROOT,
      encoding: 'utf8'
    });
    assert.notEqual(cliFail.status, 0);
    assert.match(cliFail.stderr + cliFail.stdout, /Refusing to write outside dist directory/);

    const danglingLink = path.join(distDir, 'dangling-dir');
    fs.symlinkSync(path.join(outsideDir, 'missing-target'), danglingLink, symlinkType);
    assert.throws(() => resolveRealPath(danglingLink), { code: 'ENOENT' });
    assert.throws(() => resolveRealPath(path.join(danglingLink, 'nested', 'out.js')), { code: 'ENOENT' });
    assert.throws(
      () =>
        assertSafeOutputPath({
          rootDir: tempRoot,
          inputPath,
          distDir,
          outputPath: path.join(danglingLink, 'out.js')
        }),
      { code: 'ENOENT' }
    );

    const symlinkDistRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmmv-build-symdist-'));
    try {
      const symDistInput = path.join(symlinkDistRoot, 'plugin.js');
      const symDistDir = path.join(symlinkDistRoot, 'dist');
      fs.writeFileSync(symDistInput, 'var x = 1;\n', 'utf8');
      fs.symlinkSync(outsideDir, symDistDir, symlinkType);

      assert.throws(
        () =>
          assertSafeOutputPath({
            rootDir: symlinkDistRoot,
            inputPath: symDistInput,
            distDir: symDistDir,
            outputPath: path.join(symDistDir, 'out.js')
          }),
        /Refusing to write through non-canonical dist directory/
      );
    } finally {
      fs.rmSync(symlinkDistRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('stripComments preserves ES5.1 §7.3 LineTerminator boundaries across CR, LS, and PS', () => {
  assert.equal(stripComments('return/*\r*/1;'), 'return\n1;');
  assert.equal(stripComments('return/*\u2028*/1;'), 'return\n1;');
  assert.equal(stripComments('return/*\u2029*/1;'), 'return\n1;');
  assert.equal(stripComments('var a/*inline*/=1;'), 'var a =1;');
  assert.equal(stripComments('var a = 1; // c\u2028var b = 2;'), 'var a = 1; \u2028var b = 2;');
  assert.equal(stripComments('var a = 1;\u2029'), 'var a = 1;\u2029');
});

test('stripComments rescans template literal braces and regex literals without stripping content', () => {
  const input = [
    'var a = `head ${ { k: 1 /* strip */ } } /* keep */ // keep`;',
    'var b = `m1 ${1} /* keep1 */ ${ `nested ${2} /* keep2 */` } // keep3`;',
    'var c = `div ${1}` / 2; // strip',
    'var r = /foo\\/\\*bar\\*\\/baz/g; /* strip */'
  ].join('\n');

  const output = stripComments(input);
  assert.match(output, /\/\* keep \*\/ \/\/ keep`/);
  assert.match(output, /\/\* keep1 \*\//);
  assert.match(output, /\/\* keep2 \*\//);
  assert.match(output, /\/\/ keep3`/);
  assert.match(output, /var c = `div \$\{1\}` \/ 2;/);
  assert.match(output, /var r = \/foo\\\/\\\*bar\\\*\\\/baz\/g;/);
  assert.doesNotMatch(output, /\/\* strip \*\//);
  assert.doesNotMatch(output, /\/\/ strip/);
});

test('stripComments and buildPlugin handle division after contextual/future-reserved identifiers and member keywords', async () => {
  const snippet = [
    '/**! @license MIT */',
    'var type = 10, out = 20, from = 4, set = 6, get = 8, of = 12, await = 14, yield = 16;',
    'var cfg = { default: 8, return: 10, await: 12 };',
    "var half = type / 2; // don't clip",
    "out /= 2; // don't break",
    "var mid = cfg.default / 2; // don't expose midpoint",
    "var opt = cfg?.return / 2; // don't break optional chaining",
    "var optAwait = cfg?.await / 2; // don't break member await",
    "var ratio = from / 2 + set / 2 + get / 2 + of / 2 + await / 2 + yield / 2; // don't leak",
    "var undef = undefined / 2; // don't break undefined",
    "for (var i = of / 2; i < 1; i++) {} // don't break for-init of"
  ].join('\n');

  const stripped = stripComments(snippet);
  assert.doesNotMatch(stripped, /don't/);
  assert.match(stripped, /var half = type \/ 2;/);
  assert.match(stripped, /out \/= 2;/);
  assert.match(stripped, /var mid = cfg\.default \/ 2;/);
  assert.match(stripped, /var opt = cfg\?\.return \/ 2;/);

  const es5BuildSnippet = [
    '/**! @license MIT */',
    'var type = 10, out = 20, from = 4, of = 12, await = 14, yield = 16;',
    'var cfg = { default: 8, return: 10 };',
    "var half = type / 2; // don't clip",
    "out /= 2; // don't break",
    "var mid = cfg.default / 2; // don't expose midpoint",
    "var ratio = from / 2 + of / 2 + await / 2 + yield / 2; // don't leak",
    "var ret = cfg.return / 2; // don't fail"
  ].join('\n');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmmv-build-div-'));
  try {
    fs.writeFileSync(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({ name: '@kidthales/div-plugin', version: '0.2.0' }),
      'utf8'
    );
    fs.writeFileSync(path.join(tempRoot, 'plugin.js'), es5BuildSnippet, 'utf8');

    const outPath = await buildPlugin({ rootDir: tempRoot, cwd: tempRoot });
    const built = fs.readFileSync(outPath, 'utf8');
    assert.doesNotMatch(built, /don't/);
    assert.match(built, /type \/ 2/);
    assert.match(built, /out \/= 2/);
    assert.match(built, /cfg\.default \/ 2/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('stripComments still rescans regex literals after for-of, async await, and generator yield', () => {
  const input = [
    'for (var x of /a\\/\\*keep\\*\\//g) {} /* strip */',
    'async function f() { return await /b\\/\\*keep\\*\\//g; /* strip */ }',
    'const g = async (x) => await /c\\/\\*keep\\*\\//g; /* strip */',
    'function* gen() { yield /d\\/\\*keep\\*\\//g; /* strip */ }',
    'async function outer() {',
    '  function inner() {',
    '    var await = 10;',
    "    return await / 2; // don't leak",
    '  }',
    '  return inner() && (await /e\\/\\*keep\\*\\//g); /* strip */',
    '}'
  ].join('\n');

  const output = stripComments(input);
  assert.match(output, /\/a\\\/\\\*keep\\\*\\\/\/g/);
  assert.match(output, /\/b\\\/\\\*keep\\\*\\\/\/g/);
  assert.match(output, /\/c\\\/\\\*keep\\\*\\\/\/g/);
  assert.match(output, /\/d\\\/\\\*keep\\\*\\\/\/g/);
  assert.match(output, /\/e\\\/\\\*keep\\\*\\\/\/g/);
  assert.doesNotMatch(output, /\/\* strip \*\//);
  assert.doesNotMatch(output, /don't leak/);
});

test('eslint rejects non-ES5 syntax in plugin.js', () => {
  const result = spawnSync(process.execPath, [eslintBin, '--stdin', '--stdin-filename', 'plugin.js'], {
    cwd: ROOT,
    input: 'const x = () => 1;\n',
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0, 'ESLint must reject ES6+ syntax under ecmaVersion: 5');
  assert.match(result.stdout + result.stderr, /Parsing error/i);
});

test('tsc --noEmit rejects invalid @kidthales/pgmmv-types usage under checkJs', () => {
  const tempDir = fs.mkdtempSync(path.join(ROOT, '.tmp-tsc-probe-'));
  try {
    const probePath = path.join(tempDir, 'probe.js');
    fs.writeFileSync(
      probePath,
      [
        '/// <reference types="@kidthales/pgmmv-types/pgmmv.d.ts" />',
        '(function () {',
        '  /** @type {import("@kidthales/pgmmv-types").AgtkPlugin} */',
        '  var invalidPlugin = {',
        '    setLocale: function () {},',
        '    getInfo: function () {},',
        '    initialize: function () {',
        '      Agtk.nonexistent();',
        '    },',
        '    finalize: function () {},',
        '    setParamValue: function () {},',
        '    setInternal: function () {},',
        '    call: function () {},',
        '    execLinkCondition: function () {',
        "      return 'not-a-boolean';",
        '    }',
        '  };',
        '  return invalidPlugin;',
        '})();'
      ].join('\n'),
      'utf8'
    );

    const tsconfigPath = path.join(tempDir, 'tsconfig.json');
    fs.writeFileSync(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: {
            target: 'es2020',
            lib: ['es2020', 'dom'],
            module: 'nodenext',
            moduleResolution: 'nodenext',
            allowJs: true,
            checkJs: true,
            noEmit: true,
            strict: true,
            types: ['@kidthales/pgmmv-types']
          },
          include: ['probe.js']
        },
        null,
        2
      ),
      'utf8'
    );

    const result = spawnSync(process.execPath, [tscBin, '-p', tsconfigPath, '--noEmit'], {
      cwd: ROOT,
      encoding: 'utf8'
    });

    assert.notEqual(result.status, 0, 'tsc --noEmit must reject invalid Agtk API and return types');
    const output = result.stdout + result.stderr;
    assert.match(output, /TS2339/);
    assert.match(output, /TS2322/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
