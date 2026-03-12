import { useState, useEffect, useRef } from 'react'

const POLL_INTERVAL = 5000 // 5 seconds

// Build-time constant for mock data (not runtime check)
// Set VITE_USE_MOCK_DATA=true in .env for development with mock data
const USE_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA === 'true'

// Mock data for development/demo
function getMockStatus() {
  return {
    gpu: {
      name: 'NVIDIA RTX 4070 Ti Super',
      vramUsed: 13.2,
      vramTotal: 16,
      utilization: 45,
      temperature: 62
    },
    services: [
      { name: 'llama-server', status: 'healthy', port: 8080, uptime: 7200 },
      { name: 'Open WebUI', status: 'healthy', port: 3000, uptime: 7200 },
      { name: 'Whisper (STT)', status: 'healthy', port: 9000, uptime: 7200 },
      { name: 'Kokoro (TTS)', status: 'healthy', port: 8880, uptime: 7200 },
      { name: 'Qdrant', status: 'healthy', port: 6333, uptime: 7200 },
      { name: 'n8n', status: 'healthy', port: 5678, uptime: 7200 }
    ],
    model: {
      name: 'Qwen2.5-32B-Instruct-AWQ',
      tokensPerSecond: 54,
      contextLength: 32768
    },
    bootstrap: null, // null means no bootstrap in progress
    uptime: 7200, // seconds
    version: '1.0.0',
    tier: 'Professional'
  }
}

const MOCK_STATUS = getMockStatus()

// Named export for dev-only mocking (explicit opt-in via VITE_USE_MOCK_DATA)
export { getMockStatus }

const DEFAULT_STATUS = {
  gpu: null,
  services: [],
  model: null,
  bootstrap: null,
  uptime: 0
}

export function useSystemStatus() {
  const [status, setStatus] = useState(USE_MOCK_DATA ? MOCK_STATUS : DEFAULT_STATUS)
  const [loading, setLoading] = useState(!USE_MOCK_DATA)
  const [error, setError] = useState(null)

  // Guard against overlapping fetches — if the API is slow (e.g.
  // llama-server under inference load) we skip the next poll rather
  // than stacking concurrent requests that can amplify the problem.
  const fetchInFlight = useRef(false)

  // Abort controller for cancelling pending fetches on unmount
  const abortControllerRef = useRef(null)

  useEffect(() => {
    // If using mock data, don't attempt API call
    if (USE_MOCK_DATA) {
      setLoading(false)
      return
    }

    const fetchStatus = async (signal) => {
      // Skip this tick if the previous fetch hasn't returned yet.
      if (fetchInFlight.current) return
      fetchInFlight.current = true

      try {
        const response = await fetch('/api/status', { signal })

        // Check if request was aborted
        if (signal?.aborted) return

        if (!response.ok) throw new Error('Failed to fetch status')
        const data = await response.json()
        setStatus(data)
        setError(null)
      } catch (err) {
        // Don't set error if request was aborted
        if (err.name === 'AbortError') return
        setError(err.message)
        // Keep previous status on error so the UI doesn't flash
      } finally {
        fetchInFlight.current = false
        if (!signal?.aborted) {
          setLoading(false)
        }
      }
    }

    // Create new abort controller for this effect
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    fetchStatus(abortController.signal)
    const interval = setInterval(() => {
      fetchStatus(abortController.signal)
    }, POLL_INTERVAL)

    return () => {
      abortController.abort()
      clearInterval(interval)
    }
  }, [])

  return { status, loading, error }
}
