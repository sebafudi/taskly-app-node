// Single source of truth for how repository paths are treated by the agent.
// Both the MCP server and the workflow's deterministic steps read these rules,
// so the agent and the guard can never disagree about what is testable or writable.

export const PROJECTS = {
  backend: {
    dir: 'backend',
    testGlobs: ['backend/tests/**/*.test.ts'],
    // Backend tests live in a flat tests/ directory (tests/router.test.ts covers src/features/todos/router.ts).
    testLayout: 'flat',
  },
  frontend: {
    dir: 'frontend',
    testGlobs: ['frontend/src/**/*.test.ts', 'frontend/src/**/*.test.tsx'],
    // Frontend tests sit next to the module they cover.
    testLayout: 'colocated',
  },
};

// First matching rule wins. `testable` means "a unit test for this file is expected when it changes".
const RULES = [
  { glob: '{backend,frontend}/**/node_modules/**', kind: 'dependency', testable: false, reason: 'Installed dependency.' },
  { glob: 'backend/tests/**/*.test.ts', kind: 'test', testable: false, reason: 'Test file.' },
  { glob: 'backend/tests/**', kind: 'test-support', testable: false, reason: 'Shared test fixture or helper.' },
  { glob: 'backend/src/generated/**', kind: 'generated', testable: false, reason: 'Generated Prisma client.' },
  { glob: 'backend/src/**/types.ts', kind: 'types', testable: false, reason: 'Type declarations only, no runtime behaviour.' },
  { glob: 'backend/src/main.ts', kind: 'entrypoint', testable: false, reason: 'Process entry point; its behaviour lives in core/lifespan.ts.' },
  { glob: 'backend/src/**/*.ts', kind: 'source', testable: true },
  { glob: 'backend/prisma/**', kind: 'schema', testable: false, reason: 'Database schema; covered through repository tests, not unit tests of its own.' },
  { glob: 'backend/openapi.json', kind: 'api-spec', testable: false, reason: 'API description document.' },
  { glob: 'frontend/src/**/*.test.{ts,tsx}', kind: 'test', testable: false, reason: 'Test file.' },
  { glob: 'frontend/src/test/**', kind: 'test-support', testable: false, reason: 'Shared test fixture or setup.' },
  { glob: 'frontend/src/design-system/mocks.tsx', kind: 'test-support', testable: false, reason: 'Vitest doubles for the design system.' },
  { glob: 'frontend/src/**/*.stories.tsx', kind: 'story', testable: false, reason: 'Storybook story.' },
  { glob: 'frontend/src/**/{types,*.types}.ts', kind: 'types', testable: false, reason: 'Type declarations only, no runtime behaviour.' },
  { glob: 'frontend/src/**/index.ts', kind: 'barrel', testable: false, reason: 'Re-export barrel.' },
  { glob: 'frontend/src/**/*.styles.ts', kind: 'styles', testable: false, reason: 'Styling only.' },
  { glob: 'frontend/src/design-system/**', kind: 'design-system', testable: false, reason: 'Design system is excluded from unit coverage by frontend/vite.config.ts and documented through Storybook.' },
  { glob: 'frontend/src/main.tsx', kind: 'entrypoint', testable: false, reason: 'Browser entry point.' },
  { glob: 'frontend/src/**/*.css', kind: 'styles', testable: false, reason: 'Styling only.' },
  { glob: 'frontend/src/**/*.{ts,tsx}', kind: 'source', testable: true },
  { glob: '{backend,frontend}/{package.json,package-lock.json,tsconfig*.json,vitest.config.ts,vite.config.ts,prisma.config.ts,Dockerfile,nginx.conf,.npmrc}', kind: 'config', testable: false, reason: 'Build or tooling configuration.' },
  { glob: '.github/**', kind: 'ci', testable: false, reason: 'Automation and agent configuration.' },
  { glob: 'tools/**', kind: 'tooling', testable: false, reason: 'Agent tooling; it has its own node:test suite.' },
  { glob: '**/*.md', kind: 'docs', testable: false, reason: 'Documentation.' },
  { glob: '**', kind: 'other', testable: false, reason: 'Not application source code.' },
];

// Paths the agent is allowed to create or modify. Anything else in its patch is rejected.
export const WRITABLE_GLOBS = [
  'backend/tests/**/*.test.ts',
  'backend/tests/**/*.fixture.ts',
  'backend/tests/fixture.ts',
  'frontend/src/**/*.test.ts',
  'frontend/src/**/*.test.tsx',
  'frontend/src/test/**/*.ts',
  'frontend/src/test/**/*.tsx',
];

const globCache = new Map();

// Minimal glob support: **, *, ? and {a,b}. Enough for the rules above without a dependency.
export function globToRegExp(glob) {
  if (globCache.has(glob)) return globCache.get(glob);
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      source += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else if (char === '{') {
      const end = glob.indexOf('}', i);
      source += `(?:${glob.slice(i + 1, end).split(',').map(escape).join('|')})`;
      i = end;
    } else source += escape(char);
  }
  const regexp = new RegExp(`^${source}$`);
  globCache.set(glob, regexp);
  return regexp;
}

function escape(text) {
  return text.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
}

export function matches(path, globs) {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

export function projectOf(path) {
  return Object.entries(PROJECTS).find(([, project]) => path.startsWith(`${project.dir}/`))?.[0] ?? null;
}

export function classify(path) {
  const rule = RULES.find((candidate) => globToRegExp(candidate.glob).test(path));
  return {
    project: projectOf(path),
    kind: rule.kind,
    testable: rule.testable,
    reason: rule.reason ?? 'Application source with runtime behaviour.',
  };
}

export function isWritable(path) {
  return matches(path, WRITABLE_GLOBS);
}
