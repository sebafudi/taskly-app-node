import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { compareRuns, runAgainstBase } from './baseline.mjs';
import { addedLines, changedFiles, resolveRange, workingTreeChanges } from './git.mjs';
import { checkChanges } from './guard.mjs';
import { PROJECTS, classify } from './policy.mjs';
import { changedLineCoverage, runVitest, uncoveredLines } from './vitest.mjs';

export const FLAKE_RUNS = 3;

// Independent verification of the agent's work. Nothing here trusts what the agent reported:
// it re-derives the change set from git, re-runs the tests, and measures coverage itself.
//   prBase   - the pull request's base (merge-base) revision
//   agentBase - the PR head before the agent ran; changes after it are the agent's
export function verify({ root, prBase, agentBase }) {
  const pr = resolveRange({ base: prBase, head: 'HEAD', cwd: root });
  const agentStart = resolveRange({ base: agentBase, head: 'HEAD', cwd: root }).baseSha;
  const agentChanges = dedupe([
    ...changedFiles({ baseSha: agentStart, headSha: pr.headSha, cwd: root }),
    ...workingTreeChanges({ cwd: root }),
  ]);
  const guard = checkChanges({ root, changes: agentChanges, baseRef: agentStart });

  const prChanges = changedFiles({ baseSha: pr.baseSha, headSha: pr.headSha, cwd: root }).map((change) => ({ ...change, ...classify(change.path) }));
  const projects = {};
  for (const name of new Set([...prChanges, ...agentChanges.map((change) => ({ ...change, ...classify(change.path) }))].map((change) => change.project).filter(Boolean))) {
    const agentTests = agentChanges.filter((change) => change.status !== 'deleted' && classify(change.path).project === name && /\.test\.tsx?$/.test(change.path)).map((change) => change.path);
    const full = runVitest({ root, project: name, coverage: true });
    const repeats = agentTests.length ? Array.from({ length: FLAKE_RUNS - 1 }, () => runVitest({ root, project: name, files: agentTests })) : [];
    const sensitivity = agentTests.length ? compareRuns(runVitest({ root, project: name, files: agentTests }), runAgainstBase({ root, base: pr.baseSha, project: name, files: agentTests })) : null;
    projects[name] = {
      agentTests,
      tests: { success: full.success, total: full.total, passed: full.passed, failed: full.failed, skipped: full.skipped, failures: failures(full), error: full.error, log: full.success ? undefined : full.log },
      flaky: flakyTests(full, repeats, agentTests),
      // The agent's push does not re-trigger CI, so hold its tests to the same checks CI runs.
      static: agentTests.length ? staticChecks(root, name, agentTests) : null,
      sensitivity: sensitivity && { detectingChange: sensitivity.detectingChange, passingOnBoth: sensitivity.passingOnBoth, total: sensitivity.tests.length },
      coverage: full.coverage?.total,
      changedFiles: prChanges
        .filter((change) => change.project === name && change.testable && change.status !== 'deleted')
        .map((change) => {
          const metrics = full.coverage?.files[change.path];
          if (!metrics) return { path: change.path, lines: 0, changedLines: null, uncoveredLines: 'not loaded by any test' };
          return {
            path: change.path,
            lines: metrics.lines,
            branches: metrics.branches,
            uncoveredLines: uncoveredLines(metrics.lineHits),
            changedLines: changedLineCoverage(metrics.lineHits, addedLines({ baseSha: pr.baseSha, headSha: pr.headSha, path: change.path, cwd: root })),
          };
        }),
    };
  }

  const testsPass = Object.values(projects).every((project) => project.tests.success);
  const noFlakes = Object.values(projects).every((project) => !project.flaky.length);
  const staticOk = Object.values(projects).every((project) => !project.static || (project.static.typecheck.ok && project.static.format.ok));
  return {
    ok: guard.ok && testsPass && noFlakes && staticOk,
    prBase: pr.baseSha,
    head: pr.headSha,
    agentBase: agentStart,
    guard: { ok: guard.ok, violations: guard.violations, warnings: guard.warnings, files: agentChanges.map((change) => change.path) },
    projects,
  };
}

function dedupe(changes) {
  return [...new Map(changes.map((change) => [change.path, change])).values()];
}

function failures(run) {
  return run.files.flatMap((file) => [
    ...(file.message && !file.tests.length ? [{ file: file.file, name: '(suite failed to load)', failure: file.message }] : []),
    ...file.tests.filter((test) => test.status === 'failed').map((test) => ({ file: file.file, name: test.name, failure: test.failure })),
  ]);
}

// A test the agent wrote that does not pass consistently across repeated runs.
function flakyTests(full, repeats, agentTests) {
  const outcomes = new Map();
  for (const run of [full, ...repeats]) {
    for (const file of run.files.filter((candidate) => agentTests.some((test) => test.endsWith(candidate.file)))) {
      for (const test of file.tests) {
        const key = `${file.file} > ${test.name}`;
        outcomes.set(key, [...(outcomes.get(key) ?? []), test.status]);
      }
    }
  }
  return [...outcomes].filter(([, statuses]) => new Set(statuses).size > 1).map(([name, statuses]) => ({ name, statuses }));
}

// Typecheck the whole project (tests are part of each tsconfig) and format-check the agent's files
// where the project uses Prettier. Both run from the project's own installed binaries.
export function staticChecks(root, projectName, files) {
  const cwd = join(root, PROJECTS[projectName].dir);
  const run = (binary, args) => {
    const path = join(cwd, 'node_modules', '.bin', binary);
    if (!existsSync(path)) return null;
    const result = spawnSync(path, args, { cwd, encoding: 'utf8', timeout: 180_000, env: { ...process.env, FORCE_COLOR: '0' } });
    return { ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim().slice(-2000) || undefined };
  };
  const relative = files.map((file) => file.slice(PROJECTS[projectName].dir.length + 1));
  return {
    typecheck: run('tsc', ['--noEmit', '-p', '.']) ?? { ok: true, skipped: 'no TypeScript compiler installed' },
    format: run('prettier', ['--check', ...relative]) ?? { ok: true, skipped: 'project does not use Prettier' },
  };
}
