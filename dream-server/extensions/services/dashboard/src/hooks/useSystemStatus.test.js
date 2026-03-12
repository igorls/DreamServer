import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSystemStatus } from '../hooks/useSystemStatus'
import { createMockStatus, createMockGpu, createMockService } from '../test/utils'

describe('useSystemStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should fetch status on mount', async () => {
    const mockStatus = createMockStatus()
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockStatus,
    })

    const { result } = renderHook(() => useSystemStatus())

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.status).toEqual(mockStatus)
    expect(result.current.error).toBeNull()
  })

  it('should handle fetch errors', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useSystemStatus())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Network error')
    expect(result.current.status).toEqual({
      gpu: null,
      services: [],
      model: null,
      bootstrap: null,
      uptime: 0,
    })
  })

  it('should handle non-ok responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'Internal server error' }),
    })

    const { result } = renderHook(() => useSystemStatus())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('Failed to fetch status')
  })

  it('should handle bootstrap status', async () => {
    const mockStatus = createMockStatus({
      bootstrap: {
        active: true,
        model: 'llama-3-70b',
        percent: 45.5,
        bytesDownloaded: 15000000000,
        bytesTotal: 33000000000,
        speedMbps: 25.5,
        eta: 720,
      },
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockStatus,
    })

    const { result } = renderHook(() => useSystemStatus())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.status.bootstrap.active).toBe(true)
    expect(result.current.status.bootstrap.percent).toBe(45.5)
    expect(result.current.status.bootstrap.model).toBe('llama-3-70b')
  })

  it('should handle GPU with unified memory', async () => {
    const mockStatus = createMockStatus({
      gpu: createMockGpu({
        memoryType: 'unified',
        name: 'Apple M2 Max',
        vramTotal: 0,
      }),
      ram: { used_gb: 12, total_gb: 32, percent: 37.5 },
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockStatus,
    })

    const { result } = renderHook(() => useSystemStatus())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.status.gpu.memoryType).toBe('unified')
    expect(result.current.status.ram.total_gb).toBe(32)
  })

  it('should handle degraded services', async () => {
    const mockStatus = createMockStatus({
      services: [
        createMockService({ name: 'llama-server', status: 'healthy' }),
        createMockService({ name: 'Open WebUI', status: 'degraded' }),
        createMockService({ name: 'Whisper', status: 'unhealthy' }),
        createMockService({ name: 'n8n', status: 'down' }),
      ],
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockStatus,
    })

    const { result } = renderHook(() => useSystemStatus())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.status.services).toHaveLength(4)
    expect(result.current.status.services[1].status).toBe('degraded')
    expect(result.current.status.services[2].status).toBe('unhealthy')
    expect(result.current.status.services[3].status).toBe('down')
  })

  it('should not use mock data by default', async () => {
    // Ensure VITE_USE_MOCK_DATA is not set
    vi.stubEnv('VITE_USE_MOCK_DATA', undefined)

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => createMockStatus(),
    })

    const { result } = renderHook(() => useSystemStatus())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Should have called the real API
    expect(global.fetch).toHaveBeenCalledWith('/api/status', expect.any(Object))
  })

  it('should handle missing optional fields gracefully', async () => {
    const minimalStatus = {
      gpu: null,
      services: [],
      uptime: 0,
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => minimalStatus,
    })

    const { result } = renderHook(() => useSystemStatus())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.status.gpu).toBeNull()
    expect(result.current.status.services).toEqual([])
  })

  it('should abort pending fetch on unmount', async () => {
    const abortController = {
      signal: { aborted: false },
      abort: vi.fn(() => {
        abortController.signal.aborted = true
      }),
    }
    
    const OriginalAbortController = global.AbortController
    global.AbortController = vi.fn(() => abortController)

    let resolveFetch
    global.fetch = vi.fn().mockImplementation((url, options) => 
      new Promise(resolve => {
        resolveFetch = resolve
      })
    )

    const { unmount } = renderHook(() => useSystemStatus())

    // Unmount before fetch completes
    unmount()

    // Should have called abort
    expect(abortController.abort).toHaveBeenCalled()

    // Restore original AbortController
    global.AbortController = OriginalAbortController

    // Resolve the fetch (should be ignored due to abort)
    await act(async () => {
      resolveFetch({ ok: true, json: async () => createMockStatus() })
    })
  })

  it('should set up polling interval', async () => {
    const mockStatus = createMockStatus()
    let callCount = 0

    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++
      return {
        ok: true,
        json: async () => mockStatus,
      }
    })

    const { unmount } = renderHook(() => useSystemStatus())

    await waitFor(() => {
      expect(result => result.current.loading === false)
    })

    // Initial fetch
    expect(callCount).toBe(1)

    // Unmount to stop polling
    unmount()

    // Advance time - should not trigger more fetches since unmounted
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    // Should still be 1 since we unmounted before interval could fire
    expect(callCount).toBe(1)
  })
})
