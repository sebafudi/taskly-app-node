#!/usr/bin/env node
// Deterministic entry points used by the PR workflow around the agent:
//   analyze  - before the agent: what changed and what needs tests (also decides whether to run the agent at all)
//   verify   - after the agent: policy guard, full test runs, flake and base-sensitivity checks
//   report   - render a verification JSON file as Markdown
import { writeFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { analyzeChanges } from './lib/analyze.mjs';
import { repoRoot } from './lib/git.mjs';
import { analysisMarkdown, verificationMarkdown } from './lib/report.mjs';
import { verify } from './lib/verify.mjs';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string' },
    head: { type: 'string' },
    'agent-base': { type: 'string' },
    coverage: { type: 'boolean', default: false },
    out: { type: 'string' },
    markdown: { type: 'string' },
    in: { type: 'string' },
    'run-url': { type: 'string' },
  },
});

const root = repoRoot();
const [command] = positionals;

function write(result, markdown) {
  const json = JSON.stringify(result, null, 2);
  if (values.out) writeFileSync(values.out, json);
  else process.stdout.write(`${json}\n`);
  if (values.markdown) writeFileSync(values.markdown, markdown);
}

switch (command) {
  case 'analyze': {
    const analysis = analyzeChanges({ root, base: values.base, head: values.head, coverage: values.coverage });
    write(analysis, analysisMarkdown(analysis));
    break;
  }
  case 'verify': {
    const result = verify({ root, prBase: values.base, agentBase: values['agent-base'] ?? 'HEAD' });
    write(result, verificationMarkdown(result, { runUrl: values['run-url'] }));
    process.exitCode = result.ok ? 0 : 1;
    break;
  }
  case 'report': {
    const result = JSON.parse(readFileSync(values.in, 'utf8'));
    process.stdout.write(`${verificationMarkdown(result, { runUrl: values['run-url'] })}\n`);
    break;
  }
  default:
    console.error('Usage: test-agent <analyze|verify|report> [--base REF] [--head REF] [--agent-base REF] [--coverage] [--out FILE] [--markdown FILE] [--in FILE]');
    process.exitCode = 2;
}
