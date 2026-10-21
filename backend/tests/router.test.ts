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
  expect(response.body).toEqual({ total: 2, active: 1, completed: 1, overdue: 0, dueToday: 1, dueSoon: 0 });
  expect(repository.list).toHaveBeenCalledOnce();
});
it('defaults the stats date to the current day', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
  try {
    const { app } = setup();
    const response = await request(app).get('/api/todos/stats');
    expect(response.body).toEqual({ total: 1, active: 1, completed: 0, overdue: 1, dueToday: 0, dueSoon: 0 });
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
it.each([['get', undefined], ['patch', { title: 'New' }], ['delete', undefined]] as const)(
  'rejects invalid ids on %s without calling the repository', async (method, body) => {
    const { app, repository } = setup();
    for (const id of ['abc', '0', '-1', '1.5']) {
      const response = await request(app)[method](`/api/todos/${id}`).send(body);
      expect(response.status).toBe(422);
      expect(response.body.detail).toBeDefined();
    }
    expect(repository.get).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.delete).not.toHaveBeenCalled();
  },
);
it('gets a task by ID', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(todo);
  const response = await request(app).get('/api/todos/1');
  expect(response.status).toBe(200);
  expect(response.body).toEqual(todo);
  expect(repository.get).toHaveBeenCalledWith(1);
});
it('returns 404 when getting a missing task', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(null);
  const response = await request(app).get('/api/todos/7');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
  expect(repository.get).toHaveBeenCalledWith(7);
});
it('updates only the provided fields with trimmed input', async () => {
  const { app, repository } = setup();
  repository.update.mockResolvedValue(todo);
  const response = await request(app).patch('/api/todos/1').send({ title: '  Renamed  ', completed: true });
  expect(response.status).toBe(200);
  expect(response.body).toEqual(todo);
  expect(repository.update).toHaveBeenCalledWith(1, { title: 'Renamed', completed: true });
});
it.each([{}, { title: '  ' }, { priority: 'urgent' }, { unknown: 1 }])(
  'rejects invalid update input without calling the repository: %j', async (payload) => {
    const { app, repository } = setup();
    expect((await request(app).patch('/api/todos/1').send(payload)).status).toBe(422);
    expect(repository.update).not.toHaveBeenCalled();
  },
);
it('returns 404 when updating a missing task', async () => {
  const { app, repository } = setup();
  repository.update.mockResolvedValue(null);
  const response = await request(app).patch('/api/todos/3').send({ completed: true });
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
  expect(repository.update).toHaveBeenCalledWith(3, { completed: true });
});
it('deletes a task and responds with an empty 204', async () => {
  const { app, repository } = setup();
  repository.delete.mockResolvedValue(true);
  const response = await request(app).delete('/api/todos/1');
  expect(response.status).toBe(204);
  expect(response.text).toBe('');
  expect(repository.delete).toHaveBeenCalledWith(1);
});
it('returns 404 when deleting a missing task', async () => {
  const { app, repository } = setup();
  repository.delete.mockResolvedValue(false);
  const response = await request(app).delete('/api/todos/9');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
  expect(repository.delete).toHaveBeenCalledWith(9);
});
