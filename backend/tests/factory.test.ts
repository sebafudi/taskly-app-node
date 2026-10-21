import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createApp } from '../src/factory.ts';
import type { Database } from '../src/features/todos/types.ts';
import { record, todo } from './fixture.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const todoDelegate = { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([record]) };
  const database = { todo: todoDelegate } as unknown as Database;
  return { app: createApp(database), todoDelegate };
}
it('does not advertise the framework in response headers', async () => {
  const { app } = setup();
  expect((await request(app).get('/api/health')).headers['x-powered-by']).toBeUndefined();
});
it('wires the health and todos routers to the database', async () => {
  const { app, todoDelegate } = setup();
  expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok' });
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
  expect(todoDelegate.findMany).toHaveBeenCalledOnce();
});
it('serves the OpenAPI specification as JSON', async () => {
  const { app } = setup();
  const response = await request(app).get('/openapi.json');
  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('openapi');
  expect(response.body).toHaveProperty('paths');
});
it('serves the Swagger UI under /docs', async () => {
  const { app } = setup();
  const response = await request(app).get('/docs/');
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('text/html');
});
it('returns a JSON 404 for unknown routes', async () => {
  const { app } = setup();
  const response = await request(app).get('/nope');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Not Found' });
});
it('returns 422 for malformed JSON bodies', async () => {
  const { app, todoDelegate } = setup();
  const response = await request(app).post('/api/todos').set('Content-Type', 'application/json').send('{');
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
  expect(todoDelegate.findMany).not.toHaveBeenCalled();
});
it('returns 413 for oversized bodies', async () => {
  const { app } = setup();
  const response = await request(app).post('/api/todos').send({ title: 'x'.repeat(200_000) });
  expect(response.status).toBe(413);
  expect(response.body).toEqual({ detail: 'Request body too large.' });
});
it('returns a generic 500 and logs when a handler throws', async () => {
  const { app, todoDelegate } = setup();
  const error = new Error('db down');
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  todoDelegate.findMany.mockRejectedValue(error);
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(JSON.stringify(response.body)).not.toContain('db down');
  expect(log).toHaveBeenCalledWith(error);
});
