// Markdown rendering for the verification report. The numbers come from deterministic
// measurements, never from model output. Test names, failure messages and file paths still
// originate from pull request code, so every such string goes through inline() or block().

export const REPORT_MARKER = '<!-- unit-test-agent:verification -->';

// Inline text: no HTML, no mentions, no table breaks, no code-span escapes.
export function inline(text) {
  return String(text ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[<>]/g, (char) => (char === '<' ? '&lt;' : '&gt;'))
    .replace(/\|/g, '\\|')
    .replace(/`/g, "'")
    .replace(/@(?=\w)/g, '@\u200b')
    .slice(0, 300);
}

// Text inside a fenced code block: just make sure it cannot close the fence.
export function block(text, max = 1200) {
  return String(text ?? '').replace(/```/g, "'''").slice(0, max);
}

export function verificationMarkdown(result, { runUrl } = {}) {
  const lines = [REPORT_MARKER, `## ${result.ok ? '✅' : '❌'} Unit test agent: independent verification`, ''];
  lines.push(`Measured by CI on \`${result.head.slice(0, 7)}\` against base \`${result.prBase.slice(0, 7)}\`, without relying on anything the agent reported.`, '');

  lines.push('| Project | Tests | Agent-touched test files | Detect the change¹ | Flaky (3 runs) | Types & format | Line coverage |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const [name, project] of Object.entries(result.projects)) {
    const tests = project.tests.error ? `⚠️ ${project.tests.error}` : `${project.tests.success ? '✅' : '❌'} ${project.tests.passed}/${project.tests.total} passed`;
    const sensitivity = project.sensitivity ? `${project.sensitivity.detectingChange}/${project.sensitivity.total}` : 'n/a';
    const checks = project.static ? (project.static.typecheck.ok && project.static.format.ok ? '✅' : `❌ ${[!project.static.typecheck.ok && 'types', !project.static.format.ok && 'format'].filter(Boolean).join(', ')}`) : 'n/a';
    lines.push(`| ${name} | ${tests} | ${project.agentTests.length} | ${sensitivity} | ${project.flaky.length ? `❌ ${project.flaky.length}` : '✅ none'} | ${checks} | ${project.coverage ? `${project.coverage.lines}%` : 'n/a'} |`);
  }
  lines.push('', '¹ Tests in agent-touched files that pass on this PR but fail against the base branch code, so they check the new behaviour rather than only existing code.', '');

  const changed = Object.entries(result.projects).flatMap(([name, project]) => project.changedFiles.map((file) => ({ ...file, project: name })));
  if (changed.length) {
    lines.push('### Coverage of files changed in this PR', '', '| File | Changed lines covered | File lines | Still uncovered |', '| --- | --- | --- | --- |');
    for (const file of changed) {
      const changedLines = file.changedLines?.pct == null ? 'n/a' : `${file.changedLines.pct}% (${file.changedLines.covered}/${file.changedLines.executable})`;
      lines.push(`| \`${inline(file.path)}\` | ${changedLines} | ${file.lines ?? 0}% | ${file.uncoveredLines || '-'} |`);
    }
    lines.push('');
  }

  if (!result.guard.ok || result.guard.warnings.length) {
    lines.push('### Policy checks on agent changes', '');
    for (const item of result.guard.violations) lines.push(`- ❌ \`${inline(item.path)}\`: ${item.message}`);
    for (const item of result.guard.warnings) lines.push(`- ⚠️ \`${inline(item.path)}\`: ${item.message}`);
    lines.push('');
  }

  const failures = Object.values(result.projects).flatMap((project) => project.tests.failures);
  if (failures.length) {
    lines.push('<details><summary>Failing tests</summary>', '');
    for (const failure of failures.slice(0, 10)) lines.push(`**${inline(failure.file)}** › ${inline(failure.name)}`, '', '```', block(failure.failure), '```', '');
    lines.push('</details>', '');
  }
  for (const [name, project] of Object.entries(result.projects)) {
    for (const [check, outcome] of Object.entries(project.static ?? {})) {
      if (outcome.ok) continue;
      lines.push(`<details><summary>${name}: ${check === 'typecheck' ? 'type errors' : 'formatting'}</summary>`, '', '```', block(outcome.output), '```', '</details>', '');
    }
  }
  const flaky = Object.values(result.projects).flatMap((project) => project.flaky);
  if (flaky.length) {
    lines.push('<details><summary>Flaky tests</summary>', '');
    for (const test of flaky) lines.push(`- ${inline(test.name)}: ${test.statuses.join(', ')}`);
    lines.push('</details>', '');
  }
  if (runUrl) lines.push(`[Workflow run](${runUrl})`);
  return lines.join('\n');
}

export function analysisMarkdown(analysis) {
  const lines = [`Base \`${analysis.base.slice(0, 7)}\`, head \`${analysis.head.slice(0, 7)}\`: ${analysis.summary.changedFiles} files changed, ${analysis.summary.actionable} need test work.`, ''];
  lines.push('| File | Kind | Action | Tests | Changed lines covered |', '| --- | --- | --- | --- | --- |');
  for (const file of analysis.files) {
    const tests = file.relatedTests?.length ? file.relatedTests.map((test) => `\`${inline(test)}\``).join(', ') : file.suggestedTestPath ? `new: \`${inline(file.suggestedTestPath)}\`` : '-';
    const coverage = file.coverage?.changedLines?.pct == null ? '-' : `${file.coverage.changedLines.pct}%`;
    lines.push(`| \`${inline(file.path)}\` | ${file.kind} | ${file.action} | ${tests} | ${coverage} |`);
  }
  return lines.join('\n');
}
