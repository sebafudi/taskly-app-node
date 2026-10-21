import { afterEach, it, expect, vi } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

afterEach(() => vi.unstubAllEnvs());

const names = ['DATABASE_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'DB_PORT', 'POSTGRES_DB'] as const;
function setup(values: Partial<Record<(typeof names)[number], string>> = {}) {
  // Stub every variable, because config.ts loads the root .env at import time.
  for (const name of names) vi.stubEnv(name, values[name] ?? '');
}
const parts = { POSTGRES_USER: 'user', POSTGRES_PASSWORD: 'pass', POSTGRES_HOST: 'db', DB_PORT: '5433', POSTGRES_DB: 'taskly' };

it('prefers the explicit override over DATABASE_URL', () => {
  setup({ DATABASE_URL: 'postgresql://env/db' });
  expect(resolveDatabaseUrl('postgresql://override/db')).toBe('postgresql://override/db');
});
it('uses DATABASE_URL when no override is given', () => {
  setup({ DATABASE_URL: 'postgresql://env/db' });
  expect(resolveDatabaseUrl()).toBe('postgresql://env/db');
});
it('rewrites the SQLAlchemy psycopg scheme to postgresql', () => {
  setup({ DATABASE_URL: 'postgresql+psycopg://u:p@h:5432/d' });
  expect(resolveDatabaseUrl()).toBe('postgresql://u:p@h:5432/d');
});
it('builds the URL from the POSTGRES variables', () => {
  setup(parts);
  expect(resolveDatabaseUrl()).toBe('postgresql://user:pass@db:5433/taskly');
});
it('escapes special characters in credentials and database name', () => {
  setup({ ...parts, POSTGRES_USER: 'us er', POSTGRES_PASSWORD: 'p@ss/word', POSTGRES_DB: 'my db' });
  const url = new URL(resolveDatabaseUrl());
  expect(decodeURIComponent(url.username)).toBe('us er');
  expect(decodeURIComponent(url.password)).toBe('p@ss/word');
  expect(url.hostname).toBe('db');
  expect(decodeURIComponent(url.pathname)).toBe('/my db');
});
it.each(['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'DB_PORT', 'POSTGRES_DB'] as const)(
  'throws naming the missing variable %s', (name) => {
    setup({ ...parts, [name]: '' });
    expect(() => resolveDatabaseUrl()).toThrow(`Missing environment variable: ${name}`);
  },
);
