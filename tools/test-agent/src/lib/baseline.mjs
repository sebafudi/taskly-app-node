import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertRef, git } from './git.mjs';
import { PROJECTS } from './policy.mjs';
import { runVitest } from './vitest.mjs';

// Directories that are gitignored but needed to run a project's tests in a fresh worktree.
const SHARED_DIRS = { backend: ['node_modules', 'src/generated'], frontend: ['node_modules'] };

// Runs the given (new or updated) test files against the base revision of the code.
// A test that passes on the PR but fails on the base genuinely checks the change;
// a test that passes on both still has value as a regression test but does not prove the change works.
export function runAgainstBase({ root, base, project, files }) {
  if (!files.length) return { project, files: [], tests: [] };
  const worktree = mkdtempSync(join(tmpdir(), `base-${project}-`));
  try {
    git(['worktree', 'add', '--detach', '--force', worktree, assertRef(base)], { cwd: root });
    for (const shared of SHARED_DIRS[project]) {
      const source = join(root, PROJECTS[project].dir, shared);
      const target = join(worktree, PROJECTS[project].dir, shared);
      if (!existsSync(source) || existsSync(target)) continue;
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(source, target, 'dir');
    }
    for (const file of files) {
      mkdirSync(dirname(join(worktree, file)), { recursive: true });
      cpSync(join(root, file), join(worktree, file));
    }
    return runVitest({ root: worktree, project, files });
  } finally {
    git(['worktree', 'remove', '--force', worktree], { cwd: root, allowFailure: true });
    rmSync(worktree, { recursive: true, force: true });
  }
}

// Joins head and base results per test name.
export function compareRuns(head, base) {
  const baseStatus = new Map();
  for (const file of base.files) {
    for (const test of file.tests) baseStatus.set(`${file.file}::${test.name}`, test.status);
    // A suite that cannot even load on the base (e.g. it imports a new module) fails as a whole.
    if (!file.tests.length && file.status === 'failed') baseStatus.set(`${file.file}::*`, 'failed');
  }
  const tests = [];
  for (const file of head.files) {
    for (const test of file.tests) {
      const onBase = baseStatus.get(`${file.file}::${test.name}`) ?? baseStatus.get(`${file.file}::*`) ?? 'missing';
      tests.push({ file: file.file, name: test.name, head: test.status, base: onBase, detectsChange: test.status === 'passed' && onBase !== 'passed' });
    }
  }
  return {
    tests,
    detectingChange: tests.filter((test) => test.detectsChange).length,
    passingOnBoth: tests.filter((test) => test.head === 'passed' && test.base === 'passed').length,
  };
}
