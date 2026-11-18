import console from 'node:console';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { LanguageVariant, SyntaxKind } from 'typescript/unstable/ast';
import { createScanner } from 'typescript/unstable/ast/scanner';

const LINE_TERMINATOR_RE = /[\n\r\u2028\u2029]/;

const NON_REGEX_PREDECESSOR_TOKENS = new Set([
  SyntaxKind.Identifier,
  SyntaxKind.PrivateIdentifier,
  SyntaxKind.NumericLiteral,
  SyntaxKind.BigIntLiteral,
  SyntaxKind.StringLiteral,
  SyntaxKind.RegularExpressionLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateTail,
  SyntaxKind.CloseParenToken,
  SyntaxKind.CloseBracketToken,
  SyntaxKind.PlusPlusToken,
  SyntaxKind.MinusMinusToken,
  SyntaxKind.ThisKeyword,
  SyntaxKind.TrueKeyword,
  SyntaxKind.FalseKeyword,
  SyntaxKind.NullKeyword
]);

/**
 * Check whether a token is trivia (whitespace, newline, or comment).
 *
 * @param {number} token
 * @returns {boolean}
 */
function isTrivia(token) {
  return (
    token === SyntaxKind.SingleLineCommentTrivia ||
    token === SyntaxKind.MultiLineCommentTrivia ||
    token === SyntaxKind.NewLineTrivia ||
    token === SyntaxKind.WhitespaceTrivia
  );
}

/**
 * Normalize path casing on case-insensitive Windows filesystems for equality checks.
 *
 * @param {string} targetPath
 * @returns {string}
 */
function normalizeForCompare(targetPath) {
  return process.platform === 'win32' ? targetPath.toLowerCase() : targetPath;
}

/**
 * Resolve the canonical real path of an existing or not-yet-created target path.
 * Walks up only while segments genuinely do not exist; dangling symlinks rethrow ENOENT.
 *
 * @param {string} targetPath
 * @returns {string}
 */
export function resolveRealPath(targetPath) {
  const absolute = resolve(targetPath);
  const pending = [];
  let current = absolute;

  while (true) {
    try {
      const real = realpathSync(current);
      return pending.length > 0 ? join(real, ...pending.reverse()) : real;
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        let isDanglingSymlink = false;
        try {
          lstatSync(current);
          isDanglingSymlink = true;
        } catch {
          // Segment does not exist on disk; walk up to its parent directory.
        }
        if (isDanglingSymlink) {
          throw err;
        }
        const parent = dirname(current);
        if (parent === current) {
          return absolute;
        }
        pending.push(basename(current));
        current = parent;
        continue;
      }
      throw err;
    }
  }
}

/**
 * Verify that `outputPath` neither overwrites `inputPath` nor escapes `distDir`.
 *
 * @param {{ rootDir: string, inputPath: string, distDir: string, outputPath: string }} paths
 */
export function assertSafeOutputPath({ rootDir, inputPath, distDir, outputPath }) {
  const realRoot = resolveRealPath(rootDir);
  const realInput = resolveRealPath(inputPath);
  const realDist = resolveRealPath(distDir);
  const realOutput = resolveRealPath(outputPath);

  if (normalizeForCompare(realOutput) === normalizeForCompare(realInput)) {
    throw new Error(`Refusing to overwrite input file: ${inputPath}`);
  }

  const expectedDist = resolve(realRoot, 'dist');
  if (normalizeForCompare(realDist) !== normalizeForCompare(expectedDist)) {
    throw new Error(`Refusing to write through non-canonical dist directory (${distDir}): ${realDist}`);
  }

  const relToDist = relative(realDist, realOutput);
  const isInsideDist =
    relToDist !== '' &&
    relToDist !== '.' &&
    relToDist !== '..' &&
    !relToDist.startsWith(`..${sep}`) &&
    !relToDist.startsWith('../') &&
    !isAbsolute(relToDist);

  if (!isInsideDist) {
    throw new Error(`Refusing to write outside dist directory (${distDir}): ${outputPath}`);
  }
}

/**
 * Strip non-banner comments from JavaScript source while preserving `/**!` / `/*!` headers,
 * ES5.1 §7.3 `LineTerminator` boundaries, and template literal interpolations.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripComments(source) {
  const scanner = createScanner(false, LanguageVariant.Standard, source);
  const chunks = [];
  const templateBraceDepths = [];
  let lastNonTriviaToken = SyntaxKind.Unknown;
  let lastEnd = 0;

  for (let token = scanner.scan(); token !== SyntaxKind.EndOfFile; token = scanner.scan()) {
    if (
      (token === SyntaxKind.SlashToken || token === SyntaxKind.SlashEqualsToken) &&
      !NON_REGEX_PREDECESSOR_TOKENS.has(lastNonTriviaToken)
    ) {
      token = scanner.reScanSlashToken();
    } else if (token === SyntaxKind.TemplateHead) {
      templateBraceDepths.push(1);
    } else if (token === SyntaxKind.OpenBraceToken && templateBraceDepths.length > 0) {
      templateBraceDepths[templateBraceDepths.length - 1] += 1;
    } else if (token === SyntaxKind.CloseBraceToken && templateBraceDepths.length > 0) {
      templateBraceDepths[templateBraceDepths.length - 1] -= 1;
      if (templateBraceDepths[templateBraceDepths.length - 1] === 0) {
        token = scanner.reScanTemplateToken(false);
        if (token === SyntaxKind.TemplateMiddle) {
          templateBraceDepths[templateBraceDepths.length - 1] = 1;
        } else {
          templateBraceDepths.pop();
        }
      }
    }

    const tokenStart = scanner.getTokenStart();
    if (tokenStart > lastEnd) {
      // Preserve scanner-skipped line terminators (e.g. U+2028 / U+2029 under ES5.1 §7.3).
      chunks.push(source.slice(lastEnd, tokenStart));
    }

    const text = scanner.getTokenText();
    lastEnd = scanner.getTokenEnd();

    if (token === SyntaxKind.SingleLineCommentTrivia) {
      continue;
    }

    if (token === SyntaxKind.MultiLineCommentTrivia) {
      const isBanner = text.startsWith('/**!') || text.startsWith('/*!');
      if (isBanner) {
        chunks.push(text);
      } else {
        chunks.push(LINE_TERMINATOR_RE.test(text) ? '\n' : ' ');
      }
      continue;
    }

    if (!isTrivia(token)) {
      lastNonTriviaToken = token;
    }

    chunks.push(text);
  }

  if (lastEnd < source.length) {
    chunks.push(source.slice(lastEnd));
  }

  return chunks.join('');
}

/**
 * Build the comment-stripped, Prettier-formatted plugin distribution bundle.
 *
 * @param {{ rootDir?: string, outputArg?: string, cwd?: string }} [options]
 * @returns {Promise<string>}
 */
export async function buildPlugin(options = {}) {
  const defaultRootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const rootDir = options.rootDir ? resolve(options.rootDir) : defaultRootDir;
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'));
  const unscopedName = String(pkg.name).replace(/^@[^/]+\//, '');
  const inputPath = resolve(rootDir, 'plugin.js');
  const distDir = resolve(rootDir, 'dist');
  const defaultOutPath = resolve(distDir, `${unscopedName}-v${pkg.version}.js`);
  const outputPath = options.outputArg ? resolve(cwd, options.outputArg) : defaultOutPath;

  assertSafeOutputPath({ rootDir, inputPath, distDir, outputPath });

  const source = readFileSync(inputPath, 'utf8');
  const stripped = stripComments(source);
  const prettierConfig = await prettier.resolveConfig(inputPath);
  const formatted = await prettier.format(stripped, {
    ...(prettierConfig ?? {}),
    filepath: inputPath
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, formatted, 'utf8');
  return outputPath;
}

async function main() {
  const outputPath = await buildPlugin({ outputArg: process.argv[2] });
  console.log(`Built ${outputPath}`);
}

const isEntrypoint =
  typeof process.argv[1] === 'string' &&
  existsSync(process.argv[1]) &&
  normalizeForCompare(realpathSync(resolve(process.argv[1]))) ===
    normalizeForCompare(realpathSync(fileURLToPath(import.meta.url)));

if (isEntrypoint) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
