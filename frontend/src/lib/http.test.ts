import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { request } from './http'

const fetchMock = vi.fn()
beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

it('prefixes the API path, sends JSON headers and returns the body', async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify([{ id: 1 }]), { status: 200 }),
  )
  await expect(
    request('/todos', { method: 'POST', headers: { 'X-Trace': 'abc' } }),
  ).resolves.toEqual([{ id: 1 }])
  expect(fetchMock).toHaveBeenCalledWith('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Trace': 'abc' },
  })
})

it('resolves to undefined for an empty 204 response', async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
  await expect(request('/todos/1', { method: 'DELETE' })).resolves.toBe(
    undefined,
  )
})

it('reports a connection problem when the request cannot be sent', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
  await expect(request('/todos')).rejects.toThrow(
    'Cannot connect to the server. Please try again.',
  )
})

it('rethrows the original error when the request was aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  const abortError = new DOMException('Aborted', 'AbortError')
  fetchMock.mockRejectedValue(abortError)
  await expect(request('/todos', { signal: controller.signal })).rejects.toBe(
    abortError,
  )
})

it('explains the field limits on a validation error', async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ detail: [{ msg: 'too long' }] }), {
      status: 422,
    }),
  )
  await expect(request('/todos')).rejects.toThrow(
    'Check the task details: title up to 120 characters, description up to 2000 characters, and a valid due date.',
  )
})

it('shows the server detail message when one is given', async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ detail: 'Task not found.' }), {
      status: 404,
    }),
  )
  await expect(request('/todos/9')).rejects.toThrow('Task not found.')
})

it('falls back to a generic message for an unreadable error body', async () => {
  fetchMock.mockResolvedValue(
    new Response('<html>oops</html>', { status: 500 }),
  )
  await expect(request('/todos')).rejects.toThrow(
    'The operation failed. Please try again.',
  )
})
