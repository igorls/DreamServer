import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDownloadProgress } from '../hooks/useDownloadProgress'

describe('useDownloadProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
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

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(global.fetch).toHaveBeenCalledWith('/api/models/download-status')
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
          speedBytesPerSec: 26843545, // ~25 MB/s
          eta: 915,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'downloading',
          model: 'llama-3-70b',
          percent: 50,
          bytesDownloaded: 16500000000,
          bytesTotal: 33000000000,
          speedBytesPerSec: 27360503, // ~26 MB/s
          eta: 631,
        }),
      })

    const { result } = renderHook(() => useDownloadProgress())

    // Start polling
    act(() => {
      result.current.startPolling()
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(result.current.isDownloading).toBe(true)
    expect(result.current.progress.model).toBe('llama-3-70b')
    expect(result.current.progress.percent).toBe(25.5)
    expect(result.current.progress.speedMbps).toBeCloseTo(25.6, 1)
  })

  it('should stop polling when download completes', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'downloading',
          model: 'test-model',
          percent: 90,
          bytesDownloaded: 900000000,
          bytesTotal: 1000000000,
          speedBytesPerSec: 10000000,
          eta: 10,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'complete',
          model: 'test-model',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'idle',
          active: false,
        }),
      })

    const { result } = renderHook(() => useDownloadProgress())

    act(() => {
      result.current.startPolling()
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(result.current.isDownloading).toBe(true)

    // Advance past completion
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    expect(result.current.isDownloading).toBe(false)
    expect(result.current.progress).toBeNull()
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

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(result.current.isDownloading).toBe(false)
    expect(result.current.progress.error).toBe('Network error during download')
    expect(result.current.progress.model).toBe('failed-model')
  })

  it('should format bytes correctly', () => {
    const { result } = renderHook(() => useDownloadProgress())

    expect(result.current.formatBytes(0)).toBe('0 B')
    expect(result.current.formatBytes(1024)).toBe('1.00 KB')
    expect(result.current.formatBytes(1048576)).toBe('1.00 MB')
    expect(result.current.formatBytes(1073741824)).toBe('1.00 GB')
    expect(result.current.formatBytes(5368709120)).toBe('5.00 GB')
  })

  it('should format ETA correctly', () => {
    const { result } = renderHook(() => useDownloadProgress())

    expect(result.current.formatEta('calculating...')).toBe('calculating...')
    expect(result.current.formatEta(0)).toBe('0s')
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

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    // Should not crash, just continue with no progress
    expect(result.current.isDownloading).toBe(false)
    expect(result.current.progress).toBeNull()
  })

  it('should not start duplicate polling', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'downloading', percent: 50 }),
    })

    const { result } = renderHook(() => useDownloadProgress())

    // Call startPolling twice rapidly
    act(() => {
      result.current.startPolling()
      result.current.startPolling()
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    // Should only have one polling interval active
    const fetchCountFirst = global.fetch.mock.calls.length
    
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    const fetchCountSecond = global.fetch.mock.calls.length
    
    // Should have exactly one more fetch call after advancing
    expect(fetchCountSecond - fetchCountFirst).toBe(1)
  })

  it('should cleanup polling on unmount', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'downloading',
        model: 'test-model',
        percent: 50,
        bytesDownloaded: 500000000,
        bytesTotal: 1000000000,
      }),
    })

    const { result, unmount } = renderHook(() => useDownloadProgress())

    act(() => {
      result.current.startPolling()
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const fetchCountBeforeUnmount = global.fetch.mock.calls.length
    
    unmount()

    // Advance timers significantly
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000)
    })

    // Should not have made more fetch calls after unmount
    expect(global.fetch.mock.calls.length).toBe(fetchCountBeforeUnmount)
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

    expect(global.fetch).toHaveBeenCalledWith('/api/models/download-status')
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

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(result.current.progress.percent).toBe(0)
    expect(result.current.progress.bytesDownloaded).toBe(0)
    expect(result.current.progress.speedMbps).toBe(0)
    expect(result.current.progress.eta).toBeUndefined()
  })
})
