#!/usr/bin/env node
// MCP server that gives the unit test agent a small set of typed, bounded tools instead of a
// general shell. Every tool is deterministic and reuses the same library as the workflow's
// verification step, so the agent sees exactly the numbers CI will later check.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { analyzeChanges } from './lib/analyze.mjs';
import { compareRuns, runAgainstBase } from './lib/baseline.mjs';
import { addedLines, changedFiles, diffText, repoRoot, resolveRange, workingTreeChanges } from './lib/git.mjs';
import { checkChanges } from './lib/guard.mjs';
import { findRelatedTests } from './lib/mapping.mjs';
import { PROJECTS, classify, matches } from './lib/policy.mjs';
import { changedLineCoverage, runVitest, uncoveredLines } from './lib/vitest.mjs';

const root = repoRoot(process.env.GITHUB_WORKSPACE || process.cwd());
// TEST_AGENT_BASE: the PR base revision. TEST_AGENT_HEAD: the PR head before the agent changed anything.
const base = process.env.TEST_AGENT_BASE;
const agentStart = process.env.TEST_AGENT_HEAD || 'HEAD';
const project = z.enum(Object.keys(PROJECTS));
const repoPath = z.string().regex(/^(?!\/)(?!.*\.\.)[\w./@-]+$/, 'Repository-relative path without ..');

const server = new McpServer({ name: 'taskly-test-agent', version: '1.0.0' });

function reply(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] };
}

function tool(name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      return reply(await handler(args));
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
}

function assertTestFiles(projectName, files) {
  const outside = files.filter((file) => !matches(file, PROJECTS[projectName].testGlobs));
  if (outside.length) throw new Error(`Not ${projectName} test files: ${outside.join(', ')}`);
}

tool(
  'analyze_pr_changes',
  'List the files changed by the pull request with their kind (source, test, types, story...), whether a unit test is expected, existing related tests, the suggested test path, and the recommended action. With include_coverage, also runs the affected suites once and reports which changed lines no test executes.',
  { include_coverage: z.boolean().default(false) },
  ({ include_coverage }) => analyzeChanges({ root, base, head: agentStart, coverage: include_coverage }),
);

tool(
  'get_file_diff',
  'Unified diff of one file between the PR base and the PR head, truncated for very large changes.',
  { path: repoPath },
  ({ path }) => {
    const range = resolveRange({ base, head: agentStart, cwd: root });
    return { path, diff: diffText({ ...range, path, cwd: root }) };
  },
);

tool(
  'find_related_tests',
  'Test files that import (not mock) the given source file.',
  { path: repoPath },
  ({ path }) => {
    const { project: name } = classify(path);
    if (!name) throw new Error(`${path} is not in a known project.`);
    return { path, tests: findRelatedTests(root, path, name) };
  },
);

tool(
  'run_tests',
  'Run Vitest for a project. Pass test files (repository-relative) to run only those, or omit to run the whole suite. Returns pass/fail per test and trimmed failure messages.',
  { project, files: z.array(repoPath).max(30).default([]) },
  ({ project: name, files }) => {
    assertTestFiles(name, files);
    return runVitest({ root, project: name, files });
  },
);

tool(
  'get_coverage',
  'Run the full suite of a project with coverage and report, for each requested source file, line and branch coverage, uncovered line ranges, and coverage of the lines this PR added.',
  { project, files: z.array(repoPath).min(1).max(30) },
  ({ project: name, files }) => {
    const run = runVitest({ root, project: name, coverage: true });
    const range = resolveRange({ base, head: 'HEAD', cwd: root });
    return {
      suite: { success: run.success, total: run.total, failed: run.failed },
      files: files.map((path) => {
        const metrics = run.coverage?.files[path];
        if (!metrics) return { path, note: 'Not loaded by any test (0% coverage) or excluded by the coverage config.' };
        return {
          path,
          lines: metrics.lines,
          branches: metrics.branches,
          functions: metrics.functions,
          uncoveredLines: uncoveredLines(metrics.lineHits),
          changedLines: changedLineCoverage(metrics.lineHits, addedLines({ ...range, path, cwd: root })),
        };
      }),
    };
  },
);

tool(
  'check_tests_against_base',
  'Run the given test files against the code from the PR base branch. Tests that pass now but fail on the base actually detect the change; tests that pass on both only guard existing behaviour.',
  { project, test_files: z.array(repoPath).min(1).max(20) },
  ({ project: name, test_files }) => {
    assertTestFiles(name, test_files);
    const range = resolveRange({ base, head: 'HEAD', cwd: root });
    const head = runVitest({ root, project: name, files: test_files });
    return compareRuns(head, runAgainstBase({ root, base: range.baseSha, project: name, files: test_files }));
  },
);

tool(
  'validate_my_changes',
  'Check everything changed since the agent started against the write policy (only test files and fixtures), and for focused/skipped tests, missing assertions, network or process access, and weakened tests. Run before finishing; violations will block the push.',
  {},
  () => {
    const start = resolveRange({ base: agentStart, head: 'HEAD', cwd: root }).baseSha;
    const changes = [...changedFiles({ baseSha: start, headSha: 'HEAD', cwd: root }), ...workingTreeChanges({ cwd: root })];
    return checkChanges({ root, changes: [...new Map(changes.map((change) => [change.path, change])).values()] });
  },
);

await server.connect(new StdioServerTransport());
