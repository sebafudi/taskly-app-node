import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { checkChanges, pathsFromPatch } from '../src/lib/guard.mjs';
import { findRelatedTests, importedModules, suggestTestPath } from '../src/lib/mapping.mjs';
import { classify, globToRegExp, isWritable } from '../src/lib/policy.mjs';
import { changedLineCoverage, toRanges } from '../src/lib/vitest.mjs';
import { assertRef } from '../src/lib/git.mjs';

const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'test-agent-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const run = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  run('init', '-q', '-b', 'main');
  run('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'init');
  run('add', '.');
  run('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'files');
  return root;
}

describe('policy', () => {
  it('classifies source files as testable and everything else with a reason', () => {
    assert.equal(classify('backend/src/features/todos/router.ts').testable, true);
    assert.equal(classify('frontend/src/features/todos/components/TodoList.tsx').kind, 'source');
    for (const [path, kind] of [
      ['backend/src/features/todos/types.ts', 'types'],
      ['backend/src/generated/prisma/client.ts', 'generated'],
      ['backend/tests/router.test.ts', 'test'],
      ['frontend/src/design-system/components/Button/Button.tsx', 'design-system'],
      ['frontend/src/design-system/components/Button/Button.stories.tsx', 'story'],
      ['frontend/src/design-system/components/Button/Button.types.ts', 'types'],
      ['frontend/src/features/todos/index.ts', 'barrel'],
      ['frontend/src/main.tsx', 'entrypoint'],
      ['frontend/package.json', 'config'],
      ['README.md', 'docs'],
      ['.github/workflows/ci.yml', 'ci'],
    ]) {
      const info = classify(path);
      assert.equal(info.kind, kind, path);
      assert.equal(info.testable, false, path);
      assert.ok(info.reason, path);
    }
  });

  it('only lets the agent write tests and fixtures', () => {
    assert.ok(isWritable('backend/tests/health.test.ts'));
    assert.ok(isWritable('frontend/src/hooks/useNotice.test.ts'));
    assert.ok(isWritable('frontend/src/test/todoFixture.ts'));
    for (const path of ['backend/src/factory.ts', 'frontend/package.json', '.github/workflows/x.yml', 'backend/vitest.config.ts', 'frontend/src/lib/http.ts']) {
      assert.equal(isWritable(path), false, path);
    }
  });

  it('supports **, * and braces in globs', () => {
    assert.ok(globToRegExp('frontend/src/**/*.test.{ts,tsx}').test('frontend/src/a/b/c.test.tsx'));
    assert.ok(globToRegExp('frontend/src/**/*.test.{ts,tsx}').test('frontend/src/c.test.ts'));
    assert.equal(globToRegExp('backend/tests/*.ts').test('backend/tests/a/b.ts'), false);
  });
});

describe('mapping', () => {
  it('treats imports as coverage but vi.mock factories as not', () => {
    const content = [
      "import { TodoList } from './TodoList'",
      "vi.mock('../../design-system', () => import('../../design-system/mocks'))",
      "vi.mock('./TodoItem', () => ({ TodoItem: () => null }))",
    ].join('\n');
    assert.deepEqual(importedModules('/', 'frontend/src/features/todos/components/TodoList.test.tsx', content), ['frontend/src/features/todos/components/TodoList']);
  });

  it('finds tests through .js/.ts import specifiers and suggests paths per layout', () => {
    const root = repo({
      'backend/src/features/todos/router.ts': 'export {}',
      'backend/tests/router.test.ts': "import { createTodosRouter } from '../src/features/todos/router.ts'",
      'backend/src/api/router.ts': 'export {}',
      'frontend/src/hooks/useNotice.ts': 'export {}',
    });
    assert.deepEqual(findRelatedTests(root, 'backend/src/features/todos/router.ts', 'backend'), ['backend/tests/router.test.ts']);
    assert.equal(suggestTestPath(root, 'backend/src/features/todos/router.ts', 'backend'), 'backend/tests/router.test.ts');
    // A different module with the same name must not reuse the existing file.
    assert.equal(suggestTestPath(root, 'backend/src/api/router.ts', 'backend'), 'backend/tests/api-router.test.ts');
    assert.equal(suggestTestPath(root, 'frontend/src/hooks/useNotice.ts', 'frontend'), 'frontend/src/hooks/useNotice.test.ts');
  });
});

describe('guard', () => {
  it('blocks source edits, deletions, focused and skipped tests, and tests without assertions', () => {
    const root = repo({
      'frontend/src/a.test.ts': "it.only('x', () => { expect(1).toBe(1) })",
      'frontend/src/b.test.ts': "it.skip('x', () => { expect(1).toBe(1) })",
      'frontend/src/c.test.ts': "it('x', () => {})",
      'frontend/src/d.test.ts': "it('x', () => { expect(1).toBe(1) })",
      'frontend/src/lib/http.ts': 'export {}',
    });
    const result = checkChanges({
      root,
      changes: [
        { path: 'frontend/src/a.test.ts', status: 'added' },
        { path: 'frontend/src/b.test.ts', status: 'added' },
        { path: 'frontend/src/c.test.ts', status: 'added' },
        { path: 'frontend/src/d.test.ts', status: 'added' },
        { path: 'frontend/src/lib/http.ts', status: 'modified' },
        { path: 'backend/tests/router.test.ts', status: 'deleted' },
      ],
    });
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.violations.map((item) => `${item.path}:${item.code}`).sort(),
      ['backend/tests/router.test.ts:deletion', 'frontend/src/a.test.ts:focused-test', 'frontend/src/b.test.ts:skipped-test', 'frontend/src/c.test.ts:no-assertions', 'frontend/src/lib/http.ts:path-not-allowed'],
    );
  });

  it('warns when an update removes assertions', () => {
    const root = repo({ 'frontend/src/a.test.ts': "it('x', () => { expect(1).toBe(1); expect(2).toBe(2) })" });
    writeFileSync(join(root, 'frontend/src/a.test.ts'), "it('x', () => { expect(1).toBe(1) })");
    const result = checkChanges({ root, changes: [{ path: 'frontend/src/a.test.ts', status: 'modified' }] });
    assert.equal(result.ok, true);
    assert.deepEqual(result.warnings.map((item) => item.code), ['assertions-removed']);
  });

  it('reads paths and statuses from a unified diff', () => {
    const patch = ['diff --git a/x.ts b/x.ts', 'new file mode 100644', '--- /dev/null', 'diff --git a/y.ts b/y.ts', 'deleted file mode 100644'].join('\n');
    assert.deepEqual(pathsFromPatch(patch), [{ path: 'x.ts', previousPath: undefined, status: 'added' }, { path: 'y.ts', previousPath: undefined, status: 'deleted' }]);
  });
});

describe('coverage helpers', () => {
  it('compresses line lists into ranges', () => {
    assert.equal(toRanges([5, 1, 2, 3, 9, 10]), '1-3, 5, 9-10');
  });

  it('measures coverage of added executable lines only', () => {
    const hits = { 1: true, 2: false, 3: true, 7: false };
    assert.deepEqual(changedLineCoverage(hits, [2, 3, 4, 5]), { executable: 2, covered: 1, pct: 50, uncovered: '2' });
    assert.equal(changedLineCoverage(hits, [4, 5]).pct, null);
  });
});

describe('git input hardening', () => {
  it('rejects refs that could be parsed as options or contain shell syntax', () => {
    assert.equal(assertRef('origin/main'), 'origin/main');
    assert.throws(() => assertRef('--upload-pack=evil'));
    assert.throws(() => assertRef('main;rm -rf /'));
  });
});

describe('report escaping', async () => {
  const { inline, block } = await import('../src/lib/report.mjs');

  it('neutralises markdown, HTML and mentions from PR-controlled strings', () => {
    assert.equal(inline('a|b <img src=x> @octocat `x`\nnext'), "a\\|b &lt;img src=x&gt; @​octocat 'x' next");
  });

  it('keeps failure output inside its code fence', () => {
    assert.equal(block('boom\n```\n# injected'), "boom\n'''\n# injected");
  });
});
