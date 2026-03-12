/**
 * Test utilities for dashboard tests
 */

import { vi } from 'vitest'

/**
 * Create a mock fetch response
 */
export function mockFetchResponse(data, options = {}) {
  const response = {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  }
  global.fetch = vi.fn().mockResolvedValue(response)
  return response
}

/**
 * Create a mock fetch error
 */
export function mockFetchError(message, status = 500) {
  const response = {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({ detail: message }),
    text: vi.fn().mockResolvedValue(message),
  }
  global.fetch = vi.fn().mockRejectedValue(new Error(message))
  return response
}

/**
 * Create mock GPU data
 */
export function createMockGpu(overrides = {}) {
  return {
    name: 'NVIDIA RTX 4070 Ti',
    vramTotal: 16,
    vramUsed: 8.5,
    vramFree: 7.5,
    utilization: 45,
    temperature: 62,
    memoryType: 'discrete',
    ...overrides,
  }
}

/**
 * Create mock model data
 */
export function createMockModel(overrides = {}) {
  return {
    id: 'test-model',
    name: 'Test Model',
    family: 'TestFamily',
    description: 'A test model',
    size_gb: 8.5,
    vram_required_gb: 10,
    context_length: 32768,
    tokens_per_sec_estimate: 50,
    quantization: 'Q4_K_M',
    specialty: 'General',
    backend: 'llama-server',
    status: 'available',
    fits_vram: true,
    ...overrides,
  }
}

/**
 * Create mock service data
 */
export function createMockService(overrides = {}) {
  return {
    name: 'test-service',
    status: 'healthy',
    port: 8080,
    uptime: 3600,
    ...overrides,
  }
}

/**
 * Create mock system status
 */
export function createMockStatus(overrides = {}) {
  return {
    gpu: createMockGpu(),
    services: [
      createMockService({ name: 'llama-server', port: 8080 }),
      createMockService({ name: 'Open WebUI', port: 3000 }),
    ],
    model: { name: 'Test Model', tokensPerSecond: 50 },
    inference: { tokensPerSecond: 50, lifetimeTokens: 100000 },
    uptime: 86400,
    version: '1.0.0',
    tier: 'Community',
    ...overrides,
  }
}

/**
 * Wait for async operations to complete
 */
export function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Create mock AbortController
 */
export function createMockAbortController() {
  const controller = {
    signal: { aborted: false },
    abort: vi.fn(() => {
      controller.signal.aborted = true
    }),
  }
  return controller
}
