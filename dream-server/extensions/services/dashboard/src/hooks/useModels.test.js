import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useModels, useProviders, useOllama } from '../hooks/useModels'
import { mockFetchResponse, createMockModel, createMockGpu, flushPromises, createMockAbortController } from '../test/utils'

describe('useModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should fetch models on mount', async () => {
    const mockModels = [
      createMockModel({ id: 'model-1', name: 'Model One' }),
      createMockModel({ id: 'model-2', name: 'Model Two' }),
    ]
    const mockGpu = createMockGpu()

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: mockModels, gpu: mockGpu }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      })

    const { result } = renderHook(() => useModels())

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.models).toHaveLength(2)
    expect(result.current.models[0].name).toBe('Model One')
    expect(result.current.gpu).toEqual(mockGpu)
  })

  it('should handle fetch errors', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useModels())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Network error')
    expect(result.current.models).toEqual([])
  })

  it('should handle aborted requests gracefully', async () => {
    let abortHandler
    global.fetch = vi.fn().mockImplementation((url, options) => {
      // Store the abort handler
      if (options?.signal) {
        abortHandler = options.signal
      }
      return new Promise((resolve, reject) => {
        // Simulate abort on unmount
        setTimeout(() => {
          if (options?.signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
          } else {
            resolve({ ok: true, json: async () => ({ models: [], gpu: null }) })
          }
        }, 100)
      })
    })

    const { unmount } = renderHook(() => useModels())

    // Unmount before fetch completes
    unmount()

    // Wait a bit for aborted request to resolve
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 150))
    })

    // Should not have thrown an error
    expect(global.fetch).toHaveBeenCalled()
  })

  it('should filter models by backend', async () => {
    const mockModels = [
      createMockModel({ id: 'llama-1', backend: 'llama-server' }),
      createMockModel({ id: 'ollama-1', backend: 'ollama' }),
      createMockModel({ id: 'openai-1', backend: 'openai' }),
    ]

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: mockModels, gpu: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      })

    const { result } = renderHook(() => useModels())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Test filter change
    act(() => {
      result.current.setFilter('local')
    })

    expect(result.current.filter).toBe('local')
    expect(result.current.models.map(m => m.backend)).toEqual(['llama-server'])

    act(() => {
      result.current.setFilter('ollama')
    })

    expect(result.current.models.map(m => m.backend)).toEqual(['ollama'])

    act(() => {
      result.current.setFilter('cloud')
    })

    expect(result.current.models.map(m => m.backend)).toEqual(['openai'])
  })

  it('should download a model', async () => {
    const mockModels = [createMockModel({ id: 'model-1', status: 'available' })]

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: mockModels, gpu: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'downloading' }),
      })

    const { result } = renderHook(() => useModels())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.downloadModel('model-1')
    })

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/models/model-1/download'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('should load a model', async () => {
    const mockModels = [createMockModel({ id: 'model-1', status: 'downloaded' })]

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: mockModels, gpu: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'loaded' }),
      })

    const { result } = renderHook(() => useModels())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.loadModel('model-1')
    })

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/models/model-1/load'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('should delete a model', async () => {
    const mockModels = [createMockModel({ id: 'model-1', status: 'downloaded' })]

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: mockModels, gpu: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'deleted' }),
      })

    const { result } = renderHook(() => useModels())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.deleteModel('model-1')
    })

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/models/model-1'),
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('should set actionLoading during operations', async () => {
    const mockModels = [createMockModel({ id: 'model-1' })]

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: mockModels, gpu: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      })

    const { result } = renderHook(() => useModels())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Simulate slow download
    let resolveDownload
    global.fetch = vi.fn().mockImplementation(() => 
      new Promise(resolve => {
        resolveDownload = resolve
      })
    )

    act(() => {
      result.current.downloadModel('model-1')
    })

    // Should be loading immediately after calling download
    expect(result.current.actionLoading).toBe('model-1')

    // Resolve the download
    await act(async () => {
      resolveDownload({ ok: true, json: async () => ({}) })
    })

    expect(result.current.actionLoading).toBeNull()
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

    const { unmount } = renderHook(() => useModels())

    // Unmount before fetch completes
    unmount()

    // Should have called abort
    expect(abortController.abort).toHaveBeenCalled()

    // Restore original AbortController
    global.AbortController = OriginalAbortController

    // Resolve the fetch (should be ignored due to abort)
    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ models: [], gpu: null }) })
    })
  })
})

describe('useProviders', () => {
  it('should fetch providers on mount', async () => {
    const mockProviders = [
      { id: 'openai', name: 'OpenAI', configured: true },
      { id: 'anthropic', name: 'Anthropic', configured: false },
    ]

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ providers: mockProviders }),
    })

    const { result } = renderHook(() => useProviders())

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.providers).toHaveLength(2)
    expect(result.current.providers[0].name).toBe('OpenAI')
  })

  it('should save provider configuration', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ providers: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'saved' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ providers: [{ id: 'openai', configured: true }] }),
      })

    const { result } = renderHook(() => useProviders())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.saveProvider('openai', 'sk-test', null)
    })

    expect(result.current.saving).toBeNull()
    expect(result.current.providers[0].configured).toBe(true)
  })

  it('should test connection', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ providers: [{ id: 'openai', configured: true }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok', message: 'Connected' }),
      })

    const { result } = renderHook(() => useProviders())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    let testResult
    await act(async () => {
      testResult = await result.current.testConnection('openai')
    })

    expect(testResult.status).toBe('ok')
    expect(testResult.message).toBe('Connected')
  })
})

describe('useOllama', () => {
  it('should fetch Ollama info on mount', async () => {
    const mockInfo = {
      reachable: true,
      version: '0.1.20',
      modelCount: 5,
      runningModels: [],
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockInfo,
    })

    const { result } = renderHook(() => useOllama())

    await waitFor(() => {
      expect(result.current.info).toEqual(mockInfo)
    })
  })

  it('should pull a model', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reachable: true, version: '0.1.20', modelCount: 0, runningModels: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'pulling', model: 'llama3' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ pulls: { 'llama3': { status: 'pulling', percent: 50 } } }),
      })

    const { result } = renderHook(() => useOllama())

    await waitFor(() => {
      expect(result.current.info).not.toBeNull()
    })

    await act(async () => {
      await result.current.pullModel('llama3')
    })

    expect(result.current.pulling).toBe(true)
  })

  it('should handle pull errors gracefully', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reachable: true, version: '0.1.20', modelCount: 0, runningModels: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'Model not found' }),
      })

    const { result } = renderHook(() => useOllama())

    await waitFor(() => {
      expect(result.current.info).not.toBeNull()
    })

    await act(async () => {
      await result.current.pullModel('nonexistent')
    })

    expect(result.current.error).toBe('Model not found')
  })
})
