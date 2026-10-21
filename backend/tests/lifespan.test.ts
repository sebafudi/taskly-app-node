import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { start } from '../src/core/lifespan.ts';
import { createDatabase, initialize } from '../src/core/database.ts';
import { createApp } from '../src/factory.ts';

vi.mock('../src/core/database.ts');
vi.mock('../src/factory.ts');

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
  vi.stubEnv('API_PORT', '');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.mocked(createDatabase).mockReset();
  vi.mocked(initialize).mockReset();
  vi.mocked(createApp).mockReset();
});

function setup() {
  const database = { $connect: vi.fn().mockResolvedValue(undefined), $disconnect: vi.fn().mockResolvedValue(undefined) };
  const server = Object.assign(new EventEmitter(), { address: vi.fn().mockReturnValue({ port: 8000 }), close: vi.fn() });
  const app = { listen: vi.fn((port: number, host: string, cb: () => void) => { queueMicrotask(cb); return server; }) };
  vi.mocked(createDatabase).mockReturnValue(database as never);
  vi.mocked(initialize).mockResolvedValue(undefined);
  vi.mocked(createApp).mockReturnValue(app as never);
  // Capture signal handlers instead of registering real ones.
  const handlers: Record<string, () => void> = {};
  vi.spyOn(process, 'once').mockImplementation(((event: string, handler: () => void) => { handlers[event] = handler; return process; }) as never);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  return { database, server, app, handlers, error };
}

it('connects, initializes, builds the app and listens on the default port', async () => {
  const { database, server, app } = setup();
  const result = await start();
  expect(createDatabase).toHaveBeenCalledWith('postgresql://test:test@localhost:5432/test');
  expect(database.$connect).toHaveBeenCalledOnce();
  expect(initialize).toHaveBeenCalledWith(database);
  expect(createApp).toHaveBeenCalledWith(database);
  expect(app.listen).toHaveBeenCalledWith(8000, '0.0.0.0', expect.any(Function));
  expect(result).toEqual({ server, database });
});
it('listens on the port from API_PORT', async () => {
  const { app } = setup();
  vi.stubEnv('API_PORT', '9123');
  await start();
  expect(app.listen).toHaveBeenCalledWith(9123, '0.0.0.0', expect.any(Function));
});
it.each([
  ['connect', (d: ReturnType<typeof setup>) => d.database.$connect.mockRejectedValue(new Error('connect failed')), 'connect failed'],
  ['initialize', () => vi.mocked(initialize).mockRejectedValue(new Error('init failed')), 'init failed'],
  ['createApp', () => vi.mocked(createApp).mockImplementation(() => { throw new Error('app failed'); }), 'app failed'],
] as const)('disconnects and rethrows when %s fails', async (_name, fail, message) => {
  const ctx = setup();
  fail(ctx);
  await expect(start()).rejects.toThrow(message);
  expect(ctx.database.$disconnect).toHaveBeenCalledOnce();
  expect(ctx.handlers.SIGTERM).toBeUndefined();
});
it('disconnects and rethrows when the server emits an error while listening', async () => {
  const { database, server, app } = setup();
  app.listen.mockImplementation(() => { queueMicrotask(() => server.emit('error', new Error('EADDRINUSE'))); return server; });
  await expect(start()).rejects.toThrow('EADDRINUSE');
  expect(database.$disconnect).toHaveBeenCalledOnce();
});
it('closes the server then disconnects on SIGTERM and SIGINT', async () => {
  const { database, server, handlers } = setup();
  await start();
  expect(Object.keys(handlers).sort()).toEqual(['SIGINT', 'SIGTERM']);
  server.close.mockImplementation(async (cb: () => Promise<void>) => { await cb(); });
  handlers.SIGTERM();
  await vi.waitFor(() => expect(database.$disconnect).toHaveBeenCalledOnce());
  expect(server.close).toHaveBeenCalledOnce();
  expect(database.$disconnect.mock.invocationCallOrder[0]).toBeGreaterThan(server.close.mock.invocationCallOrder[0]);
  handlers.SIGINT();
  await vi.waitFor(() => expect(database.$disconnect).toHaveBeenCalledTimes(2));
});
it('logs and sets a failing exit code when disconnect fails during shutdown', async () => {
  const { database, server, handlers, error } = setup();
  const previous = process.exitCode;
  await start();
  const failure = new Error('disconnect failed');
  database.$disconnect.mockRejectedValue(failure);
  server.close.mockImplementation(async (cb: () => Promise<void>) => { await cb(); });
  try {
    handlers.SIGTERM();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(failure));
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = previous;
  }
});
it('forces exit with code 1 when the server does not close within 10 seconds', async () => {
  const { handlers, server } = setup();
  await start();
  vi.useFakeTimers();
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  handlers.SIGTERM();
  expect(server.close).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(9999);
  expect(exit).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(exit).toHaveBeenCalledWith(1);
});
