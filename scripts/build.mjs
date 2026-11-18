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

const METHOD_START_BOUNDARY_TOKENS = new Set([
  SyntaxKind.Unknown,
  SyntaxKind.OpenBraceToken,
  SyntaxKind.CloseBraceToken,
  SyntaxKind.CommaToken,
  SyntaxKind.SemicolonToken
]);

const CLASS_METHOD_MODIFIER_TOKENS = new Set([
  SyntaxKind.StaticKeyword,
  SyntaxKind.PublicKeyword,
  SyntaxKind.PrivateKeyword,
  SyntaxKind.ProtectedKeyword,
  SyntaxKind.OverrideKeyword,
  SyntaxKind.ReadonlyKeyword,
  SyntaxKind.AbstractKeyword,
  SyntaxKind.AccessorKeyword,
  SyntaxKind.DeclareKeyword
]);

const CONCISE_ARROW_TERMINATOR_TOKENS = new Set([
  SyntaxKind.SemicolonToken,
  SyntaxKind.CommaToken,
  SyntaxKind.CloseParenToken,
  SyntaxKind.CloseBracketToken,
  SyntaxKind.CloseBraceToken
]);

/**
 * Check whether a token is a trivia token (whitespace, newline, or comment).
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
 * Check whether a token is any JavaScript/TypeScript keyword.
 *
 * @param {number} token
 * @returns {boolean}
 */
function isKeywordToken(token) {
  return token >= SyntaxKind.FirstKeyword && token <= SyntaxKind.LastKeyword;
}

/**
 * Check whether a token is an identifier-capable future-reserved or contextual keyword.
 *
 * @param {number} token
 * @returns {boolean}
 */
function isIdentifierCapableKeyword(token) {
  return token > SyntaxKind.LastReservedWord && token <= SyntaxKind.LastKeyword;
}

/**
 * Track token context to distinguish division (`/` and `/=`) from regex literal starts.
 *
 * @returns {{ isDivisionPredecessor: () => boolean, advance: (token: number) => void }}
 */
function createSlashPredecessorTracker() {
  let prevNonTriviaToken = SyntaxKind.Unknown;
  let lastNonTriviaToken = SyntaxKind.Unknown;
  let bracketDepth = 0;
  let nextScopeId = 1;
  let closedAsyncParen = false;

  /** @type {{ isFunction: boolean, isAsync: boolean, isGenerator: boolean, id: number }[]} */
  const braceStack = [];
  /** @type {{ isForHeader: boolean, seenSemicolon: boolean, precededByAsync: boolean, methodFn: { isAsync: boolean, isGenerator: boolean } | null }[]} */
  const parenStack = [];
  /** @type {{ isAsync: boolean, braceDepth: number, parenDepth: number, bracketDepth: number, id: number }[]} */
  const conciseArrowStack = [];
  /** @type {{ isAsync: boolean, isGenerator: boolean, targetParenDepth: number, sawParams: boolean, awaitingBody: boolean }[]} */
  const pendingFnStack = [];
  /** @type {{ isAsync: boolean, isGenerator: boolean, sawName: boolean, startBracketDepth: number } | null} */
  let pendingMethodHeader = null;
  /** @type {{ isAsync: boolean, isGenerator: boolean } | null} */
  let pendingNextBraceFn = null;
  /** @type {{ isAsync: boolean } | null} */
  let pendingArrow = null;

  function currentFunctionScope() {
    let latestFn = null;
    for (let i = braceStack.length - 1; i >= 0; i -= 1) {
      if (braceStack[i].isFunction) {
        latestFn = braceStack[i];
        break;
      }
    }
    const topArrow = conciseArrowStack[conciseArrowStack.length - 1];
    if (topArrow && (!latestFn || topArrow.id > latestFn.id)) {
      return { isAsync: topArrow.isAsync, isGenerator: false };
    }
    if (latestFn) {
      return { isAsync: latestFn.isAsync, isGenerator: latestFn.isGenerator };
    }
    return { isAsync: false, isGenerator: false };
  }

  function popClosedConciseArrows() {
    while (conciseArrowStack.length > 0) {
      const top = conciseArrowStack[conciseArrowStack.length - 1];
      if (braceStack.length < top.braceDepth || parenStack.length < top.parenDepth || bracketDepth < top.bracketDepth) {
        conciseArrowStack.pop();
      } else {
        break;
      }
    }
  }

  function isDivisionPredecessor() {
    if (NON_REGEX_PREDECESSOR_TOKENS.has(lastNonTriviaToken)) {
      return true;
    }

    if (
      (prevNonTriviaToken === SyntaxKind.DotToken || prevNonTriviaToken === SyntaxKind.QuestionDotToken) &&
      isKeywordToken(lastNonTriviaToken)
    ) {
      return true;
    }

    if (!isIdentifierCapableKeyword(lastNonTriviaToken)) {
      return false;
    }

    if (lastNonTriviaToken === SyntaxKind.AwaitKeyword) {
      return !currentFunctionScope().isAsync;
    }

    if (lastNonTriviaToken === SyntaxKind.YieldKeyword) {
      return !currentFunctionScope().isGenerator;
    }

    if (lastNonTriviaToken === SyntaxKind.OfKeyword) {
      const topParen = parenStack[parenStack.length - 1];
      const isForOfOperator =
        Boolean(topParen && topParen.isForHeader && !topParen.seenSemicolon) &&
        (prevNonTriviaToken === SyntaxKind.Identifier ||
          prevNonTriviaToken === SyntaxKind.CloseBracketToken ||
          prevNonTriviaToken === SyntaxKind.CloseBraceToken ||
          prevNonTriviaToken === SyntaxKind.CloseParenToken ||
          isIdentifierCapableKeyword(prevNonTriviaToken));
      return !isForOfOperator;
    }

    return true;
  }

  function advance(token) {
    if (pendingArrow) {
      if (token === SyntaxKind.OpenBraceToken) {
        pendingNextBraceFn = { isAsync: pendingArrow.isAsync, isGenerator: false };
      } else {
        conciseArrowStack.push({
          isAsync: pendingArrow.isAsync,
          braceDepth: braceStack.length,
          parenDepth: parenStack.length,
          bracketDepth,
          id: nextScopeId++
        });
      }
      pendingArrow = null;
    }

    const topPendingFn = pendingFnStack[pendingFnStack.length - 1];
    if (topPendingFn && topPendingFn.awaitingBody) {
      if (token === SyntaxKind.OpenBraceToken) {
        pendingNextBraceFn = { isAsync: topPendingFn.isAsync, isGenerator: topPendingFn.isGenerator };
      }
      pendingFnStack.pop();
    }

    if (pendingNextBraceFn && token !== SyntaxKind.OpenBraceToken) {
      pendingNextBraceFn = null;
    }

    let methodFnForParen = null;
    if (pendingMethodHeader) {
      if (token === SyntaxKind.FunctionKeyword) {
        pendingMethodHeader = null;
      } else if (bracketDepth === pendingMethodHeader.startBracketDepth) {
        if (token === SyntaxKind.OpenBracketToken && !pendingMethodHeader.sawName) {
          pendingMethodHeader.sawName = true;
        } else if (token === SyntaxKind.AsteriskToken && !pendingMethodHeader.sawName) {
          pendingMethodHeader.isGenerator = true;
        } else if (token === SyntaxKind.OpenParenToken && pendingMethodHeader.sawName) {
          methodFnForParen = {
            isAsync: pendingMethodHeader.isAsync,
            isGenerator: pendingMethodHeader.isGenerator
          };
          pendingMethodHeader = null;
        } else if (
          !pendingMethodHeader.sawName &&
          (token === SyntaxKind.Identifier ||
            token === SyntaxKind.PrivateIdentifier ||
            token === SyntaxKind.StringLiteral ||
            token === SyntaxKind.NumericLiteral ||
            isKeywordToken(token))
        ) {
          pendingMethodHeader.sawName = true;
        } else {
          pendingMethodHeader = null;
        }
      }
    } else if (
      METHOD_START_BOUNDARY_TOKENS.has(lastNonTriviaToken) ||
      CLASS_METHOD_MODIFIER_TOKENS.has(lastNonTriviaToken)
    ) {
      if (token === SyntaxKind.AsyncKeyword) {
        pendingMethodHeader = {
          isAsync: true,
          isGenerator: false,
          sawName: false,
          startBracketDepth: bracketDepth
        };
      } else if (token === SyntaxKind.AsteriskToken) {
        pendingMethodHeader = {
          isAsync: false,
          isGenerator: true,
          sawName: false,
          startBracketDepth: bracketDepth
        };
      }
    }

    if (token === SyntaxKind.FunctionKeyword) {
      pendingFnStack.push({
        isAsync: lastNonTriviaToken === SyntaxKind.AsyncKeyword,
        isGenerator: false,
        targetParenDepth: parenStack.length,
        sawParams: false,
        awaitingBody: false
      });
    } else if (
      token === SyntaxKind.AsteriskToken &&
      lastNonTriviaToken === SyntaxKind.FunctionKeyword &&
      pendingFnStack.length > 0
    ) {
      pendingFnStack[pendingFnStack.length - 1].isGenerator = true;
    }

    if (token === SyntaxKind.OpenBracketToken) {
      bracketDepth += 1;
    } else if (token === SyntaxKind.CloseBracketToken) {
      bracketDepth = Math.max(0, bracketDepth - 1);
      popClosedConciseArrows();
    } else if (token === SyntaxKind.OpenParenToken) {
      const activeFn = pendingFnStack[pendingFnStack.length - 1];
      if (activeFn && !activeFn.awaitingBody && parenStack.length === activeFn.targetParenDepth) {
        activeFn.sawParams = true;
      }
      const isForHeader =
        lastNonTriviaToken === SyntaxKind.ForKeyword ||
        (lastNonTriviaToken === SyntaxKind.AwaitKeyword && prevNonTriviaToken === SyntaxKind.ForKeyword);
      parenStack.push({
        isForHeader,
        seenSemicolon: false,
        precededByAsync: lastNonTriviaToken === SyntaxKind.AsyncKeyword,
        methodFn: methodFnForParen
      });
    } else if (token === SyntaxKind.CloseParenToken) {
      const popped = parenStack.pop();
      closedAsyncParen = Boolean(popped && popped.precededByAsync);
      if (popped && popped.methodFn) {
        pendingNextBraceFn = popped.methodFn;
      }
      const activeFn = pendingFnStack[pendingFnStack.length - 1];
      if (activeFn && activeFn.sawParams && !activeFn.awaitingBody && parenStack.length === activeFn.targetParenDepth) {
        activeFn.awaitingBody = true;
      }
      popClosedConciseArrows();
    } else if (token === SyntaxKind.OpenBraceToken) {
      if (pendingNextBraceFn) {
        braceStack.push({
          isFunction: true,
          isAsync: pendingNextBraceFn.isAsync,
          isGenerator: pendingNextBraceFn.isGenerator,
          id: nextScopeId++
        });
        pendingNextBraceFn = null;
      } else {
        braceStack.push({ isFunction: false, isAsync: false, isGenerator: false, id: 0 });
      }
    } else if (token === SyntaxKind.CloseBraceToken) {
      braceStack.pop();
      popClosedConciseArrows();
    } else if (token === SyntaxKind.SemicolonToken) {
      const topParen = parenStack[parenStack.length - 1];
      if (topParen && topParen.isForHeader) {
        topParen.seenSemicolon = true;
      }
    } else if (token === SyntaxKind.EqualsGreaterThanToken) {
      const isAsyncArrow =
        (prevNonTriviaToken === SyntaxKind.AsyncKeyword &&
          (lastNonTriviaToken === SyntaxKind.Identifier || isIdentifierCapableKeyword(lastNonTriviaToken))) ||
        (lastNonTriviaToken === SyntaxKind.CloseParenToken && closedAsyncParen);
      pendingArrow = { isAsync: isAsyncArrow };
    }

    if (CONCISE_ARROW_TERMINATOR_TOKENS.has(token)) {
      const topArrow = conciseArrowStack[conciseArrowStack.length - 1];
      if (
        topArrow &&
        braceStack.length === topArrow.braceDepth &&
        parenStack.length === topArrow.parenDepth &&
        bracketDepth === topArrow.bracketDepth
      ) {
        conciseArrowStack.pop();
      }
    }

    if (token !== SyntaxKind.CloseParenToken) {
      closedAsyncParen = false;
    }

    prevNonTriviaToken = lastNonTriviaToken;
    lastNonTriviaToken = token;
  }

  return { isDivisionPredecessor, advance };
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
  const tracker = createSlashPredecessorTracker();
  let lastEnd = 0;

  for (let token = scanner.scan(); token !== SyntaxKind.EndOfFile; token = scanner.scan()) {
    if (
      (token === SyntaxKind.SlashToken || token === SyntaxKind.SlashEqualsToken) &&
      !tracker.isDivisionPredecessor()
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
      tracker.advance(token);
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
