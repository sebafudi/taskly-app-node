import { afterEach, it, expect, vi } from 'vitest';
import { createDatabase, initialize } from '../src/core/database.ts';
import type { Database } from '../src/features/todos/types.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const $executeRaw = vi.fn().mockResolvedValue(0);
  return { database: { $executeRaw } as unknown as Database, $executeRaw };
}
it('creates a Prisma client without opening a connection', () => {
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  expect(database.todo).toBeDefined();
  expect(typeof database.$connect).toBe('function');
});
it('creates the todos table with an idempotent statement', async () => {
  const { database, $executeRaw } = setup();
  await initialize(database);
  expect($executeRaw).toHaveBeenCalledOnce();
  const sql = ($executeRaw.mock.calls[0][0] as string[]).join('');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS todos');
  expect(sql).toContain('title VARCHAR(120) NOT NULL');
});
it('propagates database errors from initialize', async () => {
  const { database, $executeRaw } = setup();
  $executeRaw.mockRejectedValue(new Error('no permission'));
  await expect(initialize(database)).rejects.toThrow('no permission');
});
