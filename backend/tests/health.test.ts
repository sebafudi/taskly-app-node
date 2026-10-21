import express from 'express';
import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createHealthRouter } from '../src/api/health.ts';
import type { Database } from '../src/features/todos/types.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const findFirst = vi.fn();
  const database = { todo: { findFirst } } as unknown as Database;
  const app = express();
  app.use('/api', createHealthRouter(database));
  return { app, findFirst };
}
it('reports ok after a cheap database probe', async () => {
  const { app, findFirst } = setup();
  findFirst.mockResolvedValue(null);
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
});
it('does not report ok when the database query fails', async () => {
  const { app, findFirst } = setup();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  findFirst.mockRejectedValue(new Error('connection refused'));
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(500);
  expect(response.body).not.toEqual({ status: 'ok' });
});
