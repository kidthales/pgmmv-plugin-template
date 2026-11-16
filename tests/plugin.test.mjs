import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const pluginPath = path.join(ROOT, 'plugin.js');
const pluginSource = fs.readFileSync(pluginPath, 'utf8');
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
