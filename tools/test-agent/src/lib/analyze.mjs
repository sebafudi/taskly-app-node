import { addedLines, changedFiles, resolveRange } from './git.mjs';
import { findRelatedTests, listTestFiles, suggestTestPath } from './mapping.mjs';
import { classify } from './policy.mjs';
import { changedLineCoverage, runVitest, uncoveredLines } from './vitest.mjs';

export const MAX_TARGETS = 12;

// Deterministic first pass over a pull request: what changed, what is testable,
// which tests already cover it, and (optionally) which changed lines no test executes.
export function analyzeChanges({ root, base, head, coverage = false }) {
  const { baseSha, headSha } = resolveRange({ base, head, cwd: root });
  const changes = changedFiles({ baseSha, headSha, cwd: root });
  const changedPaths = new Set(changes.map((change) => change.path));
  const testsByProject = {};
  const testsFor = (project) => (testsByProject[project] ??= listTestFiles(root, project));

  const files = changes.map((change) => {
    const info = { ...change, ...classify(change.path) };
    if (change.status === 'deleted') {
      if (info.testable) info.orphanedTests = orphanedTests(root, change.path, info.project, testsFor(info.project));
      return { ...info, action: info.orphanedTests?.length ? 'flag-orphaned-tests' : 'skip', addedLines: [] };
    }
    info.addedLines = addedLines({ baseSha, headSha, path: change.path, cwd: root });
    if (!info.testable) return { ...info, action: 'skip' };
    info.relatedTests = findRelatedTests(root, change.path, info.project, testsFor(info.project));
    info.relatedTestsChangedInPr = info.relatedTests.filter((test) => changedPaths.has(test));
    info.suggestedTestPath = info.relatedTests[0] ?? suggestTestPath(root, change.path, info.project);
    info.action = info.relatedTests.length ? 'update-tests' : 'create-tests';
    return info;
  });

  const targets = files.filter((file) => file.testable && file.status !== 'deleted');
  // Bound the work per run: the largest changes first, the rest listed as skipped for a human.
  targets.sort((a, b) => b.addedLines.length - a.addedLines.length);
  for (const file of targets.slice(MAX_TARGETS)) {
    file.action = 'skip';
    file.reason = `Over the per-run limit of ${MAX_TARGETS} files; left for a follow-up run.`;
  }

  const projects = {};
  for (const file of files.filter((candidate) => candidate.project)) {
    const project = (projects[file.project] ??= { sourceChanged: false, testsChanged: false });
    if (file.testable) project.sourceChanged = true;
    if (file.kind === 'test' || file.kind === 'test-support') project.testsChanged = true;
  }

  if (coverage) {
    for (const [name, project] of Object.entries(projects)) {
      if (!project.sourceChanged) continue;
      const run = runVitest({ root, project: name, coverage: true });
      project.baseline = { success: run.success, total: run.total, failed: run.failed, coverage: run.coverage?.total };
      for (const file of files.filter((candidate) => candidate.project === name && candidate.action !== 'skip' && candidate.testable)) {
        const hits = run.coverage?.files[file.path]?.lineHits;
        if (!hits) continue;
        file.coverage = {
          lines: run.coverage.files[file.path].lines,
          branches: run.coverage.files[file.path].branches,
          uncoveredLines: uncoveredLines(hits),
          changedLines: changedLineCoverage(hits, file.addedLines),
        };
      }
    }
  }

  return {
    base: baseSha,
    head: headSha,
    projects,
    summary: {
      changedFiles: files.length,
      testableFiles: targets.length,
      actionable: files.filter((file) => file.action !== 'skip').length,
    },
    files: files.map(({ addedLines: lines, ...file }) => ({ ...file, addedLineCount: lines.length })),
  };
}

// Tests that still import a module the pull request deleted. They will fail, and removing
// tests is a human decision, so the agent only reports them.
function orphanedTests(root, deletedPath, project, testFiles) {
  return findRelatedTests(root, deletedPath, project, testFiles);
}
