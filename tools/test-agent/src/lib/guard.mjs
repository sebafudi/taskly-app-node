import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { showFile, workingTreeChanges } from './git.mjs';
import { isWritable } from './policy.mjs';

const MAX_FILE_BYTES = 80_000;

// Content rules for agent-written tests. Violations block the change; warnings go to the report.
const CONTENT_RULES = [
  { pattern: /\b(?:it|test|describe)\.only\s*\(/, level: 'violation', code: 'focused-test', message: 'Focused test (.only) would silently skip the rest of the suite.' },
  { pattern: /\b(?:it|test|describe)\.(?:skip|todo)\s*\(|\bx(?:it|describe)\s*\(/, level: 'violation', code: 'skipped-test', message: 'Skipped or todo test; the agent must not hide failing behaviour.' },
  { pattern: /\bfrom\s+['"](?:node:)?(?:child_process|net|http|https|dgram)['"]|\brequire\(\s*['"](?:node:)?child_process['"]\s*\)/, level: 'violation', code: 'unsafe-import', message: 'Unit tests must not spawn processes or open network connections.' },
  { pattern: /\bfetch\(\s*['"`]https?:/, level: 'violation', code: 'real-network', message: 'Unit tests must not call real network endpoints.' },
  { pattern: /\bprocess\.env\.(?!NODE_ENV\b)[A-Z_]*(?:TOKEN|SECRET|KEY|PASSWORD)/, level: 'violation', code: 'secret-access', message: 'Tests must not read credentials from the environment.' },
  { pattern: /toMatchSnapshot\(|toMatchInlineSnapshot\(/, level: 'warning', code: 'snapshot', message: 'Snapshot assertions are discouraged; prefer explicit expectations.' },
  { pattern: /setTimeout\([^)]*,\s*\d{3,}\)/, level: 'warning', code: 'real-timer', message: 'Real timers make tests slow and flaky; prefer vi.useFakeTimers().' },
];

// Checks the agent's working tree changes against the write policy and the content rules.
export function checkChanges({ root, changes = workingTreeChanges({ cwd: root }), baseRef = 'HEAD' }) {
  const violations = [];
  const warnings = [];
  for (const change of changes) {
    const { path, status } = change;
    if (status === 'deleted') {
      violations.push({ path, code: 'deletion', message: 'The agent may not delete files; removing tests is a human decision.' });
      continue;
    }
    if (status === 'renamed' && !isWritable(change.previousPath)) {
      violations.push({ path: change.previousPath, code: 'path-not-allowed', message: 'Renamed a file outside the writable test paths.' });
    }
    if (!isWritable(path)) {
      violations.push({ path, code: 'path-not-allowed', message: 'Only test files and test fixtures may be written.' });
      continue;
    }
    const absolute = join(root, path);
    if (!existsSync(absolute)) continue;
    if (statSync(absolute).size > MAX_FILE_BYTES) {
      violations.push({ path, code: 'too-large', message: `File exceeds ${MAX_FILE_BYTES} bytes.` });
      continue;
    }
    const content = readFileSync(absolute, 'utf8');
    for (const rule of CONTENT_RULES) {
      if (rule.pattern.test(content)) (rule.level === 'violation' ? violations : warnings).push({ path, code: rule.code, message: rule.message });
    }
    if (/\.test\.tsx?$/.test(path)) {
      const assertions = countAssertions(content);
      if (assertions === 0) violations.push({ path, code: 'no-assertions', message: 'Test file contains no expect() assertions.' });
      // Updates may add or rewrite cases but never leave a test file weaker than it was.
      const previous = showFile({ ref: baseRef, path, cwd: root });
      if (previous !== null && countAssertions(previous) > assertions) {
        violations.push({ path, code: 'assertions-removed', message: `Assertions dropped from ${countAssertions(previous)} to ${assertions}; tests must not be weakened.` });
      }
      if (previous !== null && countTestCases(previous) > countTestCases(content)) {
        violations.push({ path, code: 'tests-removed', message: `Test cases dropped from ${countTestCases(previous)} to ${countTestCases(content)}; removing tests is a human decision.` });
      }
    }
  }
  return { ok: violations.length === 0, changes, violations, warnings };
}

export function countAssertions(content) {
  return (content.match(/\bexpect(?:\.soft)?\s*\(/g) ?? []).length;
}

export function countTestCases(content) {
  return (content.match(/\b(?:it|test)(?:\.each\([\s\S]*?\))?\s*\(\s*['"`]/g) ?? []).length;
}

// Paths touched by a unified diff, for validating a patch before it is applied anywhere.
export function pathsFromPatch(patch) {
  const changes = [];
  for (const match of patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) {
    const next = patch.indexOf('\ndiff --git ', match.index + 1);
    const block = patch.slice(match.index, next === -1 ? undefined : next);
    const status = /^deleted file mode/m.test(block) ? 'deleted' : /^new file mode/m.test(block) ? 'added' : match[1] !== match[2] ? 'renamed' : 'modified';
    changes.push({ path: match[2], previousPath: match[1] !== match[2] ? match[1] : undefined, status });
  }
  return changes;
}
