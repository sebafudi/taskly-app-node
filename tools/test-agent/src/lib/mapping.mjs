import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, posix, relative } from 'node:path';
import { PROJECTS, matches } from './policy.mjs';

// Lists test files of a project, as repository-relative POSIX paths.
export function listTestFiles(root, projectName) {
  const project = PROJECTS[projectName];
  const results = [];
  walk(join(root, project.dir), (file) => {
    const path = relative(root, file).split('\\').join('/');
    if (matches(path, project.testGlobs)) results.push(path);
  });
  return results.sort();
}

function walk(directory, visit) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'coverage' || entry.name.startsWith('.')) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else visit(full);
  }
}

// Relative modules a file really imports. vi.mock() targets are excluded on purpose:
// a test that mocks a module does not test it.
export function importedModules(root, path, content = readFileSync(join(root, path), 'utf8')) {
  const specifiers = new Set();
  const patterns = [/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g, /\bimport\s+['"](\.{1,2}\/[^'"]+)['"]/g, /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g];
  const withoutMocks = stripCalls(content, 'vi.mock(');
  for (const pattern of patterns) {
    for (const match of withoutMocks.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers].map((specifier) => moduleId(posix.join(posix.dirname(path), specifier)));
}

// Removes every `callee(...)` call, balancing parentheses so factories like `() => import('x')` go too.
function stripCalls(content, callee) {
  let output = '';
  let index = 0;
  for (let start = content.indexOf(callee); start !== -1; start = content.indexOf(callee, index)) {
    output += content.slice(index, start);
    let depth = 0;
    let quote = null;
    let end = start + callee.length - 1;
    for (; end < content.length; end++) {
      const char = content[end];
      if (quote) {
        if (char === '\\') end++;
        else if (char === quote) quote = null;
      } else if (char === "'" || char === '"' || char === '`') quote = char;
      else if (char === '(') depth++;
      else if (char === ')' && --depth === 0) break;
    }
    index = end + 1;
  }
  return output + content.slice(index);
}

// Normalises a path to an extension-less module id so `./router.js`, `./router.ts` and `router.ts` match.
export function moduleId(path) {
  return path.replace(/\.(?:[cm]?[jt]sx?)$/, '').replace(/\/index$/, '');
}

export function findRelatedTests(root, sourcePath, projectName, testFiles = listTestFiles(root, projectName)) {
  const target = moduleId(sourcePath);
  return testFiles.filter((test) => importedModules(root, test).includes(target));
}

// Where a new test for `sourcePath` should go, following each project's existing layout.
export function suggestTestPath(root, sourcePath, projectName) {
  const project = PROJECTS[projectName];
  const extension = extname(sourcePath) === '.tsx' ? '.tsx' : '.ts';
  const name = basename(sourcePath, extname(sourcePath));
  if (project.testLayout === 'colocated') return posix.join(dirname(sourcePath), `${name}.test${extension}`);
  const flat = `${project.dir}/tests/${name}.test.ts`;
  // Keep the flat layout unless another module already owns that file name.
  if (!existsSync(join(root, flat)) || importedModules(root, flat).includes(moduleId(sourcePath))) return flat;
  const parts = dirname(sourcePath).split('/').slice(2).filter((part) => part !== 'features');
  return `${project.dir}/tests/${[...parts, name].join('-')}.test.ts`;
}
