import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDownloadProgress } from '../hooks/useDownloadProgress'

describe('useDownloadProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should start with no download active', () => {
    global.fetch = vi.fn()
    
    const { result } = renderHook(() => useDownloadProgress())

    expect(result.current.isDownloading).toBe(false)
    expect(result.current.progress).toBeNull()
  })

  it('should fetch download status on mount', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'idle',
        active: false,
      }),
    })

    const { result } = renderHook(() => useDownloadProgress())

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })

    expect(result.current.isDownloading).toBe(false)
  })

  it('should track active download progress', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'downloading',
          model: 'llama-3-70b',
          percent: 25.5,
          bytesDownloaded: 8415000000,
          bytesTotal: 33000000000,
          speedBytesPerSec: 26843545,
          eta: 915,
        }),
      })

    const { result } = renderHook(() => useDownloadProgress())

    // Start polling
    act(() => {
      result.current.startPolling()
    })

    await waitFor(() => {
      expect(result.current.isDownloading).toBe(true)
    })

    expect(result.current.progress.model).toBe('llama-3-70b')
    expect(result.current.progress.percent).toBe(25.5)
  })

  it('should handle download errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'error',
        model: 'failed-model',
        message: 'Network error during download',
      }),
    })

    const { result } = renderHook(() => useDownloadProgress())

    act(() => {
      result.current.startPolling()
    })

    await waitFor(() => {
      expect(result.current.progress).not.toBeNull()
    })

    expect(result.current.isDownloading).toBe(false)
    expect(result.current.progress.error).toBe('Network error during download')
    expect(result.current.progress.model).toBe('failed-model')
  })

  it('should format bytes correctly', () => {
    const { result } = renderHook(() => useDownloadProgress())

    expect(result.current.formatBytes(0)).toBe('0 B')
    expect(result.current.formatBytes(1024)).toBe('1 KB')
    expect(result.current.formatBytes(1048576)).toBe('1.0 MB')
    expect(result.current.formatBytes(1073741824)).toBe('1.00 GB') // toFixed(2) for GB
    expect(result.current.formatBytes(5368709120)).toBe('5.00 GB')
  })

  it('should format ETA correctly', () => {
    const { result } = renderHook(() => useDownloadProgress())

    expect(result.current.formatEta('calculating...')).toBe('calculating...')
    expect(result.current.formatEta(undefined)).toBe('calculating...')
    // Note: formatEta returns 'calculating...' for 0 because !0 is true
    expect(result.current.formatEta(0)).toBe('calculating...')
    expect(result.current.formatEta(45)).toBe('45s')
    expect(result.current.formatEta(120)).toBe('2m 0s')
    expect(result.current.formatEta(3665)).toBe('61m 5s')
  })

  it('should handle fetch errors gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useDownloadProgress())

    act(() => {
      result.current.startPolling()
    })

    // Wait for the fetch to complete
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })

    // Should not crash, just continue with no progress
    expect(result.current.isDownloading).toBe(false)
    expect(result.current.progress).toBeNull()
  })

  it('should handle refresh function', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'downloading',
        model: 'refresh-test',
        percent: 75,
        bytesDownloaded: 750000000,
        bytesTotal: 1000000000,
      }),
    })

    const { result } = renderHook(() => useDownloadProgress())

    await act(async () => {
      await result.current.refresh()
    })

    expect(global.fetch).toHaveBeenCalledWith('/api/models/download-status', expect.any(Object))
    expect(result.current.progress.percent).toBe(75)
  })

  it('should handle missing optional fields in response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'downloading',
        model: 'minimal-model',
        // Missing: percent, bytesDownloaded, speedBytesPerSec, eta
      }),
    })

    const { result } = renderHook(() => useDownloadProgress())

    act(() => {
      result.current.startPolling()
    })

    await waitFor(() => {
      expect(result.current.progress).not.toBeNull()
    })

    expect(result.current.progress.percent).toBe(0)
    expect(result.current.progress.bytesDownloaded).toBe(0)
    expect(result.current.progress.speedMbps).toBe(0)
  })

  it('should abort fetch on unmount', async () => {
    const abortController = {
      signal: { aborted: false },
      abort: vi.fn(() => {
        abortController.signal.aborted = true
      }),
    }
    
    const OriginalAbortController = global.AbortController
    global.AbortController = vi.fn(() => abortController)

    global.fetch = vi.fn().mockImplementation((url, options) => 
      new Promise(resolve => {
        resolve({ ok: true, json: async () => ({ status: 'idle' }) })
      })
    )

    const { unmount } = renderHook(() => useDownloadProgress())

    // Unmount
    unmount()

    // Should have called abort
    expect(abortController.abort).toHaveBeenCalled()

    // Restore original AbortController
    global.AbortController = OriginalAbortController
  })
})
