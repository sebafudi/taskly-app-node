import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it } from 'vitest'
import { todoKeys } from '../api/queryKeys'
import { useTodosBusy } from './useTodosBusy'

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

function useBusyWithMutation(mutationKey: readonly string[]) {
  const mutation = useMutation({
    mutationKey,
    mutationFn: () => new Promise<void>(() => {}),
  })
  return { busy: useTodosBusy(), mutate: mutation.mutate }
}

it('is idle when no task mutation is running', () => {
  const { wrapper } = setup()
  const { result } = renderHook(() => useTodosBusy(), { wrapper })
  expect(result.current).toBe(false)
})

it('is busy while any task mutation is pending', async () => {
  const { wrapper } = setup()
  const { result } = renderHook(() => useBusyWithMutation(todoKeys.update), {
    wrapper,
  })
  act(() => result.current.mutate())
  await waitFor(() => expect(result.current.busy).toBe(true))
})

it('ignores pending mutations outside the task keys', async () => {
  const { client, wrapper } = setup()
  const { result } = renderHook(() => useBusyWithMutation(['settings']), {
    wrapper,
  })
  act(() => result.current.mutate())
  await waitFor(() => expect(client.isMutating()).toBe(1))
  expect(result.current.busy).toBe(false)
})
