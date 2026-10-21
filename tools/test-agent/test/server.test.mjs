import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, before, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Talks to the real server over stdio, the way the agent runtime does.
const client = new Client({ name: 'test', version: '1.0.0' });

before(async () => {
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
    env: { ...process.env, TEST_AGENT_BASE: 'HEAD', TEST_AGENT_HEAD: 'HEAD' },
  }));
});
after(() => client.close());

it('exposes the agent tool set', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'analyze_pr_changes', 'check_tests_against_base', 'find_related_tests', 'get_coverage', 'get_file_diff', 'run_tests', 'validate_my_changes',
  ]);
});

it('finds the tests of a source file', async () => {
  const result = await client.callTool({ name: 'find_related_tests', arguments: { path: 'backend/src/features/todos/router.ts' } });
  assert.deepEqual(JSON.parse(result.content[0].text).tests, ['backend/tests/router.test.ts']);
});

it('refuses to run files that are not tests of the project', async () => {
  const result = await client.callTool({ name: 'run_tests', arguments: { project: 'backend', files: ['backend/src/main.ts'] } });
  assert.equal(result.isError, true);
});

it('rejects path traversal', async () => {
  const result = await client.callTool({ name: 'get_file_diff', arguments: { path: '../../etc/passwd' } });
  assert.equal(result.isError, true);
});
