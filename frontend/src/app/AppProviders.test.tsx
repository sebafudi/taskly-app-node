import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { useTheme } from 'styled-components'
import { expect, it, vi } from 'vitest'
import { GlobalStyles, theme } from '../design-system'
import { queryClient } from '../lib/queryClient'
import { AppProviders } from './AppProviders'

vi.mock('../design-system', () => import('../design-system/mocks'))

let seenClient: QueryClient | undefined
let seenTheme: unknown

function Probe() {
  seenClient = useQueryClient()
  seenTheme = useTheme()
  return <p>App content</p>
}

it('renders children with the theme, global styles and a given client', () => {
  const client = new QueryClient()
  render(
    <AppProviders client={client}>
      <Probe />
    </AppProviders>,
  )
  expect(screen.getByText('App content')).toBeVisible()
  expect(seenClient).toBe(client)
  expect(seenTheme).toBe(theme)
  expect(GlobalStyles).toHaveBeenCalled()
})

it('uses the shared query client by default', () => {
  render(
    <AppProviders>
      <Probe />
    </AppProviders>,
  )
  expect(seenClient).toBe(queryClient)
})
