import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import { todo } from './fixture.ts';

function setup() {
  const repository = { list: vi.fn().mockResolvedValue([todo]), create: vi.fn().mockResolvedValue(todo), get: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}
it('lists tasks from the repository', async () => {
  const { app, repository } = setup();
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
  expect(repository.list).toHaveBeenCalledOnce();
});
it('creates tasks with trimmed input and defaults', async () => {
  const { app, repository } = setup();
  const response = await request(app).post('/api/todos').send({ title: '  Plan the sprint  ', priority: 'high' });
  expect(response.status).toBe(201);
  expect(response.body).toEqual(todo);
  expect(repository.create).toHaveBeenCalledWith({ title: 'Plan the sprint', description: '', priority: 'high', due_date: null, completed: false });
});
it.each([{ title: '  ' }, { title: 'x'.repeat(121) }, { title: 'Task', priority: 'urgent' }, { title: 'Task', due_date: '2026-02-30' }])(
  'rejects invalid create input without calling the repository: %j', async (payload) => {
    const { app, repository } = setup();
    expect((await request(app).post('/api/todos').send(payload)).status).toBe(422);
    expect(repository.create).not.toHaveBeenCalled();
  },
);
it('summarizes tasks for the given date', async () => {
  const { app, repository } = setup();
  repository.list.mockResolvedValue([{ ...todo, due_date: '2026-10-20' }, { ...todo, id: 2, completed: true }]);
  const response = await request(app).get('/api/todos/stats').query({ today: '2026-10-20' });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ total: 2, active: 1, completed: 1, overdue: 0, dueToday: 1 });
  expect(repository.list).toHaveBeenCalledOnce();
});
it('defaults the stats date to the current day', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
  try {
    const { app } = setup();
    const response = await request(app).get('/api/todos/stats');
    expect(response.body).toEqual({ total: 1, active: 1, completed: 0, overdue: 1, dueToday: 0 });
  } finally {
    vi.useRealTimers();
  }
});
it.each(['tomorrow', '2026-1-5', ''])('rejects an invalid stats date without calling the repository: %j', async (today) => {
  const { app, repository } = setup();
  const response = await request(app).get('/api/todos/stats').query({ today });
  expect(response.status).toBe(422);
  expect(response.body).toHaveProperty('detail');
  expect(repository.list).not.toHaveBeenCalled();
});
