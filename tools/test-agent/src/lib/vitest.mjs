import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { PROJECTS } from './policy.mjs';

const ANSI = /\u001b\[[0-9;]*m/g;

// Runs Vitest through the project's own installed binary (never npx, which could download code)
// and returns a compact, model-friendly summary built from Vitest's JSON reporter.
export function runVitest({ root, project: projectName, files = [], coverage = false, timeoutMs = 300_000 }) {
  const project = PROJECTS[projectName];
  if (!project) throw new Error(`Unknown project: ${projectName}`);
  const cwd = join(root, project.dir);
  const binary = join(cwd, 'node_modules', '.bin', 'vitest');
  if (!existsSync(binary)) throw new Error(`${project.dir}/node_modules is missing; run npm ci in ${project.dir} first.`);
  const output = mkdtempSync(join(tmpdir(), `vitest-${projectName}-`));
  try {
    const targets = files.map((file) => relativeToProject(root, project, file));
    // No result cache: the MCP server runs in a container as a different user, and a shared cache file
    // would leave root-owned files in the workspace.
    const args = ['run', ...targets, '--cache=false', '--reporter=json', `--outputFile=${join(output, 'results.json')}`];
    if (coverage) {
      args.push(
        '--coverage.enabled=true',
        '--coverage.reporter=json',
        '--coverage.reporter=json-summary',
        `--coverage.reportsDirectory=${join(output, 'coverage')}`,
      );
    }
    const started = Date.now();
    const result = spawnSync(binary, args, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    const summary = summarise(join(output, 'results.json'), cwd);
    summary.project = projectName;
    summary.durationMs = Date.now() - started;
    summary.exitCode = result.status;
    if (result.error?.code === 'ETIMEDOUT') summary.error = `Vitest timed out after ${timeoutMs} ms.`;
    if (!summary.files.length || summary.error) summary.log = tail(`${result.stdout}\n${result.stderr}`, 4000);
    if (coverage) summary.coverage = readCoverage(join(output, 'coverage'), root);
    return summary;
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

function relativeToProject(root, project, file) {
  const absolute = resolve(root, file);
  const path = relative(join(root, project.dir), absolute);
  if (path.startsWith('..')) throw new Error(`${file} is outside ${project.dir}/`);
  return path;
}

function summarise(resultsPath, cwd) {
  if (!existsSync(resultsPath)) {
    return { success: false, total: 0, passed: 0, failed: 0, skipped: 0, files: [], error: 'Vitest produced no results (likely a configuration or compile error).' };
  }
  const raw = JSON.parse(readFileSync(resultsPath, 'utf8'));
  const files = raw.testResults.map((file) => ({
    file: relative(cwd, file.name).split('\\').join('/'),
    status: file.status,
    message: file.message ? tail(file.message.replace(ANSI, ''), 2000) : undefined,
    tests: file.assertionResults.map((test) => ({
      name: test.fullName,
      status: test.status,
      failure: test.failureMessages?.length ? tail(test.failureMessages.join('\n').replace(ANSI, ''), 1500) : undefined,
    })),
  }));
  return {
    success: raw.success,
    total: raw.numTotalTests,
    passed: raw.numPassedTests,
    failed: raw.numFailedTests,
    skipped: raw.numPendingTests + (raw.numTodoTests ?? 0),
    failedSuites: raw.numFailedTestSuites,
    files,
  };
}

function readCoverage(directory, root) {
  const finalPath = join(directory, 'coverage-final.json');
  if (!existsSync(finalPath)) return null;
  const final = JSON.parse(readFileSync(finalPath, 'utf8'));
  const summary = JSON.parse(readFileSync(join(directory, 'coverage-summary.json'), 'utf8'));
  const files = {};
  for (const [absolute, data] of Object.entries(final)) {
    const path = relative(root, absolute).split('\\').join('/');
    const metrics = summary[absolute] ?? {};
    files[path] = {
      lines: metrics.lines?.pct,
      statements: metrics.statements?.pct,
      branches: metrics.branches?.pct,
      functions: metrics.functions?.pct,
      lineHits: lineHits(data),
    };
  }
  const total = summary.total;
  return {
    total: { lines: total.lines.pct, statements: total.statements.pct, branches: total.branches.pct, functions: total.functions.pct },
    files,
  };
}

// Maps each executable line to whether any statement on it ran.
function lineHits(data) {
  const hits = {};
  for (const [id, location] of Object.entries(data.statementMap)) {
    const line = location.start.line;
    hits[line] = (hits[line] ?? false) || data.s[id] > 0;
  }
  return hits;
}

export function uncoveredLines(lineHits) {
  return toRanges(Object.entries(lineHits).filter(([, hit]) => !hit).map(([line]) => Number(line)));
}

// Coverage of the lines a pull request added: the number reviewers care about.
export function changedLineCoverage(lineHits, added) {
  const executable = added.filter((line) => line in lineHits);
  const covered = executable.filter((line) => lineHits[line]);
  return {
    executable: executable.length,
    covered: covered.length,
    pct: executable.length ? Math.round((covered.length / executable.length) * 1000) / 10 : null,
    uncovered: toRanges(executable.filter((line) => !lineHits[line])),
  };
}

export function toRanges(lines) {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const ranges = [];
  for (const line of sorted) {
    const last = ranges.at(-1);
    if (last && line === last[1] + 1) last[1] = line;
    else ranges.push([line, line]);
  }
  return ranges.map(([start, end]) => (start === end ? `${start}` : `${start}-${end}`)).join(', ');
}

function tail(text, max) {
  return text.length > max ? `...${text.slice(-max)}` : text;
}
