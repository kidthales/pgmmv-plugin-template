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
  SyntaxKind.CloseBracketToken,
  SyntaxKind.ThisKeyword,
  SyntaxKind.SuperKeyword,
  SyntaxKind.TrueKeyword,
  SyntaxKind.FalseKeyword,
  SyntaxKind.NullKeyword
]);

const POSTFIX_UPDATE_TARGET_TOKENS = new Set([
  SyntaxKind.Identifier,
  SyntaxKind.PrivateIdentifier,
  SyntaxKind.CloseBracketToken
]);

const STATEMENT_HEADER_KEYWORDS = new Set([
  SyntaxKind.IfKeyword,
  SyntaxKind.WhileKeyword,
  SyntaxKind.ForKeyword,
  SyntaxKind.WithKeyword
]);

const EXPRESSION_PRECEDING_TOKENS = new Set([
  SyntaxKind.OpenParenToken,
  SyntaxKind.OpenBracketToken,
  SyntaxKind.CommaToken,
  SyntaxKind.EqualsGreaterThanToken,
  SyntaxKind.QuestionToken,
  SyntaxKind.DotDotDotToken,
  SyntaxKind.TemplateHead,
  SyntaxKind.TemplateMiddle,
  SyntaxKind.LessThanToken,
  SyntaxKind.GreaterThanToken,
  SyntaxKind.LessThanEqualsToken,
  SyntaxKind.GreaterThanEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.PlusToken,
  SyntaxKind.MinusToken,
  SyntaxKind.AsteriskToken,
  SyntaxKind.AsteriskAsteriskToken,
  SyntaxKind.SlashToken,
  SyntaxKind.PercentToken,
  SyntaxKind.LessThanLessThanToken,
  SyntaxKind.GreaterThanGreaterThanToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
  SyntaxKind.AmpersandToken,
  SyntaxKind.BarToken,
  SyntaxKind.CaretToken,
  SyntaxKind.ExclamationToken,
  SyntaxKind.TildeToken,
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.AsteriskEqualsToken,
  SyntaxKind.AsteriskAsteriskEqualsToken,
  SyntaxKind.SlashEqualsToken,
  SyntaxKind.PercentEqualsToken,
  SyntaxKind.LessThanLessThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  SyntaxKind.AmpersandEqualsToken,
  SyntaxKind.BarEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
  SyntaxKind.CaretEqualsToken
]);

const EXPRESSION_PRECEDING_KEYWORDS = new Set([
  SyntaxKind.ThrowKeyword,
  SyntaxKind.CaseKeyword,
  SyntaxKind.InKeyword,
  SyntaxKind.InstanceOfKeyword,
  SyntaxKind.TypeOfKeyword,
  SyntaxKind.VoidKeyword,
  SyntaxKind.DeleteKeyword,
  SyntaxKind.NewKeyword,
  SyntaxKind.ExtendsKeyword
]);

const EXPRESSION_CONTINUATION_TOKENS = new Set([
  SyntaxKind.DotToken,
  SyntaxKind.QuestionDotToken,
  SyntaxKind.OpenParenToken,
  SyntaxKind.OpenBracketToken,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateHead,
  SyntaxKind.QuestionToken,
  SyntaxKind.ColonToken,
  SyntaxKind.CommaToken,
  SyntaxKind.SemicolonToken,
  SyntaxKind.CloseParenToken,
  SyntaxKind.CloseBracketToken,
  SyntaxKind.CloseBraceToken,
  SyntaxKind.LessThanToken,
  SyntaxKind.GreaterThanToken,
  SyntaxKind.LessThanEqualsToken,
  SyntaxKind.GreaterThanEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.PlusToken,
  SyntaxKind.MinusToken,
  SyntaxKind.AsteriskToken,
  SyntaxKind.AsteriskAsteriskToken,
  SyntaxKind.SlashToken,
  SyntaxKind.PercentToken,
  SyntaxKind.LessThanLessThanToken,
  SyntaxKind.GreaterThanGreaterThanToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
  SyntaxKind.AmpersandToken,
  SyntaxKind.BarToken,
  SyntaxKind.CaretToken,
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.AsteriskEqualsToken,
  SyntaxKind.AsteriskAsteriskEqualsToken,
  SyntaxKind.SlashEqualsToken,
  SyntaxKind.PercentEqualsToken,
  SyntaxKind.LessThanLessThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  SyntaxKind.AmpersandEqualsToken,
  SyntaxKind.BarEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
  SyntaxKind.CaretEqualsToken,
  SyntaxKind.InKeyword,
  SyntaxKind.InstanceOfKeyword,
  SyntaxKind.AsKeyword,
  SyntaxKind.SatisfiesKeyword
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
 * @returns {{ isDivisionPredecessor: () => boolean, advance: (token: number, hasLineTerminatorSinceLastToken?: boolean) => void }}
 */
function createSlashPredecessorTracker() {
  let prevNonTriviaToken = SyntaxKind.Unknown;
  let lastNonTriviaToken = SyntaxKind.Unknown;
  let prevWasMemberKeyword = false;
  let lastWasMemberKeyword = false;
  let bracketDepth = 0;
  let nextScopeId = 1;
  let closedAsyncParen = false;
  let lastClosedParenWasStatementHeader = false;
  let lastClosedParenWasSwitch = false;
  let lastClosedBraceWasExpr = false;
  let lastUpdateWasPostfix = false;
  let expectsExpression = false;
  let asyncStartedInExpression = false;
  let afterExportDefault = false;

  /** @type {number[]} */
  const delimiterTernaryStack = [0];
  /** @type {{ type: 'block' | 'object' | 'class' | 'switch', isFunction: boolean, isAsync: boolean, isGenerator: boolean, isExprBrace: boolean, parenDepth: number, bracketDepth: number, id: number }[]} */
  const braceStack = [];
  /** @type {{ isForHeader: boolean, isStatementHeader: boolean, isSwitchHeader: boolean, seenSemicolon: boolean, precededByAsync: boolean, methodFn: { isAsync: boolean, isGenerator: boolean } | null }[]} */
  const parenStack = [];
  /** @type {{ isAsync: boolean, braceDepth: number, parenDepth: number, bracketDepth: number, id: number }[]} */
  const conciseArrowStack = [];
  /** @type {{ isAsync: boolean, isGenerator: boolean, isExpr: boolean, targetParenDepth: number, sawParams: boolean, awaitingBody: boolean }[]} */
  const pendingFnStack = [];
  /** @type {{ isExpr: boolean, targetParenDepth: number, targetBracketDepth: number }[]} */
  const pendingClassStack = [];
  /** @type {{ isAsync: boolean, isGenerator: boolean, sawName: boolean, startedWithAsync: boolean, canBeAccessor: boolean, startBracketDepth: number } | null} */
  let pendingMethodHeader = null;
  /** @type {{ isAsync: boolean, isGenerator: boolean, isExprBrace: boolean } | null} */
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

  function popConciseArrowsAtDepth() {
    while (conciseArrowStack.length > 0) {
      const top = conciseArrowStack[conciseArrowStack.length - 1];
      if (
        braceStack.length === top.braceDepth &&
        parenStack.length === top.parenDepth &&
        bracketDepth === top.bracketDepth
      ) {
        conciseArrowStack.pop();
      } else {
        break;
      }
    }
  }

  function isValidForOfLhsEnd() {
    return (
      prevNonTriviaToken === SyntaxKind.Identifier ||
      prevNonTriviaToken === SyntaxKind.PrivateIdentifier ||
      prevNonTriviaToken === SyntaxKind.CloseBracketToken ||
      prevNonTriviaToken === SyntaxKind.CloseBraceToken ||
      prevNonTriviaToken === SyntaxKind.CloseParenToken ||
      prevWasMemberKeyword ||
      isIdentifierCapableKeyword(prevNonTriviaToken)
    );
  }

  function isDivisionPredecessor() {
    if (NON_REGEX_PREDECESSOR_TOKENS.has(lastNonTriviaToken)) {
      return true;
    }

    if (lastNonTriviaToken === SyntaxKind.CloseParenToken) {
      return !lastClosedParenWasStatementHeader;
    }

    if (lastNonTriviaToken === SyntaxKind.CloseBraceToken) {
      return lastClosedBraceWasExpr;
    }

    if (lastNonTriviaToken === SyntaxKind.PlusPlusToken || lastNonTriviaToken === SyntaxKind.MinusMinusToken) {
      return lastUpdateWasPostfix;
    }

    if (lastWasMemberKeyword) {
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
        Boolean(topParen && topParen.isForHeader && !topParen.seenSemicolon) && isValidForOfLhsEnd();
      return !isForOfOperator;
    }

    return true;
  }

  function advance(token, hasLineTerminatorSinceLastToken = false) {
    const isMemberName =
      lastNonTriviaToken === SyntaxKind.DotToken || lastNonTriviaToken === SyntaxKind.QuestionDotToken;
    const asiBreakFromPrevious =
      hasLineTerminatorSinceLastToken &&
      !lastWasMemberKeyword &&
      (lastNonTriviaToken === SyntaxKind.ReturnKeyword ||
        (lastNonTriviaToken === SyntaxKind.YieldKeyword && currentFunctionScope().isGenerator));
    const effectiveExpectsExpression = expectsExpression && !asiBreakFromPrevious;

    if (
      hasLineTerminatorSinceLastToken &&
      conciseArrowStack.length > 0 &&
      isDivisionPredecessor() &&
      !EXPRESSION_CONTINUATION_TOKENS.has(token)
    ) {
      popConciseArrowsAtDepth();
    }

    if (pendingArrow) {
      if (token === SyntaxKind.OpenBraceToken) {
        pendingNextBraceFn = { isAsync: pendingArrow.isAsync, isGenerator: false, isExprBrace: false };
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
        pendingNextBraceFn = {
          isAsync: topPendingFn.isAsync,
          isGenerator: topPendingFn.isGenerator,
          isExprBrace: topPendingFn.isExpr
        };
      }
      pendingFnStack.pop();
    }

    if (pendingNextBraceFn && token !== SyntaxKind.OpenBraceToken) {
      pendingNextBraceFn = null;
    }

    const topBrace = braceStack[braceStack.length - 1];
    const inObjectOrClassBody =
      Boolean(topBrace && (topBrace.type === 'object' || topBrace.type === 'class')) &&
      parenStack.length === topBrace.parenDepth &&
      bracketDepth === topBrace.bracketDepth;

    let methodFnForParen = null;
    if (pendingMethodHeader) {
      if (token === SyntaxKind.FunctionKeyword) {
        pendingMethodHeader = null;
      } else if (bracketDepth === pendingMethodHeader.startBracketDepth) {
        if (token === SyntaxKind.OpenBracketToken && !pendingMethodHeader.sawName) {
          pendingMethodHeader.sawName = true;
          pendingMethodHeader.canBeAccessor = false;
        } else if (token === SyntaxKind.AsteriskToken && !pendingMethodHeader.sawName) {
          pendingMethodHeader.isGenerator = true;
          pendingMethodHeader.canBeAccessor = false;
        } else if (
          token === SyntaxKind.OpenParenToken &&
          (pendingMethodHeader.sawName || pendingMethodHeader.startedWithAsync)
        ) {
          methodFnForParen = {
            isAsync: pendingMethodHeader.sawName ? pendingMethodHeader.isAsync : false,
            isGenerator: pendingMethodHeader.isGenerator
          };
          pendingMethodHeader = null;
        } else if (
          (!pendingMethodHeader.sawName || pendingMethodHeader.canBeAccessor) &&
          (token === SyntaxKind.Identifier ||
            token === SyntaxKind.PrivateIdentifier ||
            token === SyntaxKind.StringLiteral ||
            token === SyntaxKind.NumericLiteral ||
            isKeywordToken(token))
        ) {
          pendingMethodHeader.sawName = true;
          pendingMethodHeader.canBeAccessor = false;
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
          startedWithAsync: true,
          canBeAccessor: false,
          startBracketDepth: bracketDepth
        };
      } else if (token === SyntaxKind.AsteriskToken) {
        pendingMethodHeader = {
          isAsync: false,
          isGenerator: true,
          sawName: false,
          startedWithAsync: false,
          canBeAccessor: false,
          startBracketDepth: bracketDepth
        };
      } else if (inObjectOrClassBody) {
        if (token === SyntaxKind.GetKeyword || token === SyntaxKind.SetKeyword) {
          pendingMethodHeader = {
            isAsync: false,
            isGenerator: false,
            sawName: true,
            startedWithAsync: false,
            canBeAccessor: true,
            startBracketDepth: bracketDepth
          };
        } else if (token === SyntaxKind.OpenBracketToken) {
          pendingMethodHeader = {
            isAsync: false,
            isGenerator: false,
            sawName: true,
            startedWithAsync: false,
            canBeAccessor: false,
            startBracketDepth: bracketDepth
          };
        } else if (
          (token === SyntaxKind.Identifier ||
            token === SyntaxKind.PrivateIdentifier ||
            token === SyntaxKind.StringLiteral ||
            token === SyntaxKind.NumericLiteral ||
            isKeywordToken(token)) &&
          token !== SyntaxKind.FunctionKeyword &&
          token !== SyntaxKind.ClassKeyword &&
          !CLASS_METHOD_MODIFIER_TOKENS.has(token)
        ) {
          pendingMethodHeader = {
            isAsync: false,
            isGenerator: false,
            sawName: true,
            startedWithAsync: false,
            canBeAccessor: false,
            startBracketDepth: bracketDepth
          };
        }
      }
    }

    if (!isMemberName && token === SyntaxKind.FunctionKeyword) {
      const fnExpectsExpr =
        lastNonTriviaToken === SyntaxKind.AsyncKeyword ? asyncStartedInExpression : effectiveExpectsExpression;
      pendingFnStack.push({
        isAsync: lastNonTriviaToken === SyntaxKind.AsyncKeyword && !lastWasMemberKeyword,
        isGenerator: false,
        isExpr: fnExpectsExpr && !afterExportDefault,
        targetParenDepth: parenStack.length,
        sawParams: false,
        awaitingBody: false
      });
    } else if (
      token === SyntaxKind.AsteriskToken &&
      lastNonTriviaToken === SyntaxKind.FunctionKeyword &&
      !lastWasMemberKeyword &&
      pendingFnStack.length > 0
    ) {
      pendingFnStack[pendingFnStack.length - 1].isGenerator = true;
    } else if (!isMemberName && token === SyntaxKind.ClassKeyword) {
      pendingClassStack.push({
        isExpr: effectiveExpectsExpression && !afterExportDefault,
        targetParenDepth: parenStack.length,
        targetBracketDepth: bracketDepth
      });
    }

    if (token === SyntaxKind.TemplateHead) {
      delimiterTernaryStack.push(0);
    } else if (token === SyntaxKind.TemplateMiddle) {
      delimiterTernaryStack[delimiterTernaryStack.length - 1] = 0;
    } else if (token === SyntaxKind.TemplateTail) {
      if (delimiterTernaryStack.length > 1) {
        delimiterTernaryStack.pop();
      }
    }

    if (token === SyntaxKind.OpenBracketToken) {
      bracketDepth += 1;
      delimiterTernaryStack.push(0);
    } else if (token === SyntaxKind.CloseBracketToken) {
      bracketDepth = Math.max(0, bracketDepth - 1);
      if (delimiterTernaryStack.length > 1) {
        delimiterTernaryStack.pop();
      }
      popClosedConciseArrows();
    } else if (token === SyntaxKind.OpenParenToken) {
      const activeFn = pendingFnStack[pendingFnStack.length - 1];
      if (activeFn && !activeFn.awaitingBody && parenStack.length === activeFn.targetParenDepth) {
        activeFn.sawParams = true;
      }
      const isForHeader =
        (lastNonTriviaToken === SyntaxKind.ForKeyword && !lastWasMemberKeyword) ||
        (lastNonTriviaToken === SyntaxKind.AwaitKeyword && prevNonTriviaToken === SyntaxKind.ForKeyword);
      const isStatementHeader =
        isForHeader || (STATEMENT_HEADER_KEYWORDS.has(lastNonTriviaToken) && !lastWasMemberKeyword);
      const isSwitchHeader = lastNonTriviaToken === SyntaxKind.SwitchKeyword && !lastWasMemberKeyword;
      parenStack.push({
        isForHeader,
        isStatementHeader,
        isSwitchHeader,
        seenSemicolon: false,
        precededByAsync: lastNonTriviaToken === SyntaxKind.AsyncKeyword && !lastWasMemberKeyword,
        methodFn: methodFnForParen
      });
      delimiterTernaryStack.push(0);
    } else if (token === SyntaxKind.CloseParenToken) {
      const popped = parenStack.pop();
      if (delimiterTernaryStack.length > 1) {
        delimiterTernaryStack.pop();
      }
      closedAsyncParen = Boolean(popped && popped.precededByAsync);
      lastClosedParenWasStatementHeader = Boolean(popped && popped.isStatementHeader);
      lastClosedParenWasSwitch = Boolean(popped && popped.isSwitchHeader);
      if (popped && popped.methodFn) {
        pendingNextBraceFn = {
          isAsync: popped.methodFn.isAsync,
          isGenerator: popped.methodFn.isGenerator,
          isExprBrace: false
        };
      }
      const activeFn = pendingFnStack[pendingFnStack.length - 1];
      if (activeFn && activeFn.sawParams && !activeFn.awaitingBody && parenStack.length === activeFn.targetParenDepth) {
        activeFn.awaitingBody = true;
      }
      popClosedConciseArrows();
    } else if (token === SyntaxKind.OpenBraceToken) {
      const topPendingClass = pendingClassStack[pendingClassStack.length - 1];
      if (pendingNextBraceFn) {
        braceStack.push({
          type: 'block',
          isFunction: true,
          isAsync: pendingNextBraceFn.isAsync,
          isGenerator: pendingNextBraceFn.isGenerator,
          isExprBrace: pendingNextBraceFn.isExprBrace,
          parenDepth: parenStack.length,
          bracketDepth,
          id: nextScopeId++
        });
        pendingNextBraceFn = null;
      } else if (
        topPendingClass &&
        parenStack.length === topPendingClass.targetParenDepth &&
        bracketDepth === topPendingClass.targetBracketDepth &&
        lastNonTriviaToken !== SyntaxKind.ExtendsKeyword
      ) {
        pendingClassStack.pop();
        braceStack.push({
          type: 'class',
          isFunction: false,
          isAsync: false,
          isGenerator: false,
          isExprBrace: topPendingClass.isExpr,
          parenDepth: parenStack.length,
          bracketDepth,
          id: 0
        });
      } else if (lastNonTriviaToken === SyntaxKind.CloseParenToken && lastClosedParenWasSwitch) {
        braceStack.push({
          type: 'switch',
          isFunction: false,
          isAsync: false,
          isGenerator: false,
          isExprBrace: false,
          parenDepth: parenStack.length,
          bracketDepth,
          id: 0
        });
      } else if (effectiveExpectsExpression) {
        braceStack.push({
          type: 'object',
          isFunction: false,
          isAsync: false,
          isGenerator: false,
          isExprBrace: true,
          parenDepth: parenStack.length,
          bracketDepth,
          id: 0
        });
      } else {
        braceStack.push({
          type: 'block',
          isFunction: false,
          isAsync: false,
          isGenerator: false,
          isExprBrace: false,
          parenDepth: parenStack.length,
          bracketDepth,
          id: 0
        });
      }
      delimiterTernaryStack.push(0);
    } else if (token === SyntaxKind.CloseBraceToken) {
      const poppedBrace = braceStack.pop();
      if (delimiterTernaryStack.length > 1) {
        delimiterTernaryStack.pop();
      }
      lastClosedBraceWasExpr = Boolean(poppedBrace && poppedBrace.isExprBrace);
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
      popConciseArrowsAtDepth();
    }

    if (token === SyntaxKind.PlusPlusToken || token === SyntaxKind.MinusMinusToken) {
      const canBePostfixTarget =
        POSTFIX_UPDATE_TARGET_TOKENS.has(lastNonTriviaToken) ||
        (lastNonTriviaToken === SyntaxKind.CloseParenToken && !lastClosedParenWasStatementHeader) ||
        lastWasMemberKeyword ||
        (isIdentifierCapableKeyword(lastNonTriviaToken) && isDivisionPredecessor());
      lastUpdateWasPostfix = !hasLineTerminatorSinceLastToken && canBePostfixTarget;
    } else {
      lastUpdateWasPostfix = false;
    }

    if (token !== SyntaxKind.CloseParenToken) {
      closedAsyncParen = false;
      lastClosedParenWasStatementHeader = false;
      lastClosedParenWasSwitch = false;
    }
    if (token !== SyntaxKind.CloseBraceToken) {
      lastClosedBraceWasExpr = false;
    }

    // Update expectsExpression for the token that follows `token`.
    if (token === SyntaxKind.AsyncKeyword && !isMemberName) {
      asyncStartedInExpression = effectiveExpectsExpression && !afterExportDefault;
    } else if (token !== SyntaxKind.AsyncKeyword) {
      asyncStartedInExpression = false;
    }

    const nextAfterExportDefault =
      token === SyntaxKind.DefaultKeyword && lastNonTriviaToken === SyntaxKind.ExportKeyword && !lastWasMemberKeyword;

    if (token === SyntaxKind.QuestionToken) {
      delimiterTernaryStack[delimiterTernaryStack.length - 1] += 1;
      expectsExpression = true;
    } else if (token === SyntaxKind.ColonToken) {
      const topIdx = delimiterTernaryStack.length - 1;
      if (delimiterTernaryStack[topIdx] > 0) {
        delimiterTernaryStack[topIdx] -= 1;
        expectsExpression = true;
      } else {
        const currentTopBrace = braceStack[braceStack.length - 1];
        expectsExpression = Boolean(
          currentTopBrace &&
          currentTopBrace.type === 'object' &&
          parenStack.length === currentTopBrace.parenDepth &&
          bracketDepth === currentTopBrace.bracketDepth
        );
      }
    } else if (token === SyntaxKind.SemicolonToken) {
      const topParen = parenStack[parenStack.length - 1];
      expectsExpression = Boolean(topParen && topParen.isForHeader);
    } else if (EXPRESSION_PRECEDING_TOKENS.has(token)) {
      expectsExpression = true;
    } else if (token === SyntaxKind.PlusPlusToken || token === SyntaxKind.MinusMinusToken) {
      expectsExpression = !lastUpdateWasPostfix;
    } else if (!isMemberName && isKeywordToken(token)) {
      if (token === SyntaxKind.ReturnKeyword || EXPRESSION_PRECEDING_KEYWORDS.has(token)) {
        expectsExpression = true;
      } else if (token === SyntaxKind.YieldKeyword) {
        expectsExpression = currentFunctionScope().isGenerator;
      } else if (token === SyntaxKind.AwaitKeyword) {
        expectsExpression = currentFunctionScope().isAsync;
      } else if (token === SyntaxKind.OfKeyword) {
        const topParen = parenStack[parenStack.length - 1];
        const isForOfOperator =
          Boolean(topParen && topParen.isForHeader && !topParen.seenSemicolon) &&
          (lastNonTriviaToken === SyntaxKind.Identifier ||
            lastNonTriviaToken === SyntaxKind.PrivateIdentifier ||
            lastNonTriviaToken === SyntaxKind.CloseBracketToken ||
            lastNonTriviaToken === SyntaxKind.CloseBraceToken ||
            lastNonTriviaToken === SyntaxKind.CloseParenToken ||
            lastWasMemberKeyword ||
            isIdentifierCapableKeyword(lastNonTriviaToken));
        expectsExpression = isForOfOperator;
      } else if (nextAfterExportDefault) {
        expectsExpression = true;
      } else {
        expectsExpression = false;
      }
    } else {
      expectsExpression = false;
    }

    afterExportDefault = nextAfterExportDefault;
    prevWasMemberKeyword = lastWasMemberKeyword;
    lastWasMemberKeyword = isMemberName && isKeywordToken(token);
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
  let hasLineTerminatorSinceLastToken = false;

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
      const skipped = source.slice(lastEnd, tokenStart);
      if (LINE_TERMINATOR_RE.test(skipped)) {
        hasLineTerminatorSinceLastToken = true;
      }
      // Preserve scanner-skipped line terminators (e.g. U+2028 / U+2029 under ES5.1 §7.3).
      chunks.push(skipped);
    }

    const text = scanner.getTokenText();
    lastEnd = scanner.getTokenEnd();

    if (token === SyntaxKind.SingleLineCommentTrivia) {
      continue;
    }

    if (token === SyntaxKind.MultiLineCommentTrivia) {
      if (LINE_TERMINATOR_RE.test(text)) {
        hasLineTerminatorSinceLastToken = true;
      }
      const isBanner = text.startsWith('/**!') || text.startsWith('/*!');
      if (isBanner) {
        chunks.push(text);
      } else {
        chunks.push(LINE_TERMINATOR_RE.test(text) ? '\n' : ' ');
      }
      continue;
    }

    if (token === SyntaxKind.NewLineTrivia) {
      hasLineTerminatorSinceLastToken = true;
    }

    if (!isTrivia(token)) {
      tracker.advance(token, hasLineTerminatorSinceLastToken);
      hasLineTerminatorSinceLastToken = false;
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
