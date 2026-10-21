import { execFileSync } from 'node:child_process';

export function git(args, { cwd = process.cwd(), allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
  } catch (error) {
    if (allowFailure) return null;
    throw new Error(`git ${args.join(' ')} failed: ${error.stderr?.toString().trim() || error.message}`);
  }
}

export function repoRoot(cwd = process.cwd()) {
  return git(['rev-parse', '--show-toplevel'], { cwd });
}

// Refs come from workflow inputs or the model, so only accept things that look like refs.
export function assertRef(ref) {
  if (typeof ref !== 'string' || !/^[\w./@^~-]{1,200}$/.test(ref) || ref.startsWith('-')) {
    throw new Error(`Refusing suspicious git ref: ${JSON.stringify(ref)}`);
  }
  return ref;
}

export function resolveRange({ base, head = 'HEAD', cwd }) {
  const headSha = git(['rev-parse', '--verify', `${assertRef(head)}^{commit}`], { cwd });
  const baseRef = base ?? process.env.TEST_AGENT_BASE ?? defaultBase(cwd);
  const baseSha = git(['merge-base', assertRef(baseRef), headSha], { cwd });
  return { baseSha, headSha };
}

function defaultBase(cwd) {
  for (const candidate of ['origin/main', 'main']) {
    if (git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], { cwd, allowFailure: true })) return candidate;
  }
  throw new Error('No base ref given and neither origin/main nor main exists.');
}

// Returns [{ path, status, previousPath? }] for committed changes between base and head.
export function changedFiles({ baseSha, headSha, cwd }) {
  const output = git(['diff', '--name-status', '-M', '-z', baseSha, headSha], { cwd });
  return parseNameStatus(output);
}

// Working tree changes relative to HEAD, including untracked files. Used to inspect what the agent wrote.
export function workingTreeChanges({ cwd }) {
  const tracked = parseNameStatus(git(['diff', '--name-status', '-M', '-z', 'HEAD'], { cwd }));
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], { cwd })
    .split('\0')
    .filter(Boolean)
    .map((path) => ({ path, status: 'added' }));
  return [...tracked, ...untracked];
}

const STATUS = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'modified' };

function parseNameStatus(output) {
  const parts = output.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i][0];
    if (code === 'R' || code === 'C') {
      files.push({ path: parts[i + 2], previousPath: parts[i + 1], status: STATUS[code] });
      i += 2;
    } else {
      files.push({ path: parts[i + 1], status: STATUS[code] ?? 'modified' });
      i += 1;
    }
  }
  return files;
}

// Line numbers (in the head version) added or changed by the diff.
export function addedLines({ baseSha, headSha, path, cwd }) {
  const output = git(['diff', '-U0', '--no-color', baseSha, headSha, '--', path], { cwd });
  const lines = [];
  for (const match of output.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let line = start; line < start + count; line++) lines.push(line);
  }
  return lines;
}

export function showFile({ ref, path, cwd }) {
  return git(['show', `${assertRef(ref)}:${path}`], { cwd, allowFailure: true });
}

export function diffText({ baseSha, headSha, path, cwd, maxChars = 12000 }) {
  const text = git(['diff', '--no-color', baseSha, headSha, '--', path], { cwd });
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n... diff truncated (${text.length} chars)` : text;
}
