# Dashboard Code Review Report

**Date:** 2026-03-12
**Reviewer:** Factory Droid
**Scope:** Frontend dashboard (React + Vite + Tailwind)

## Architecture Overview

- **Frontend**: React 19 + Vite + Tailwind CSS 4 + Lucide icons
- **Pages**: Dashboard, Models, Voice, Settings
- **Hooks**: useSystemStatus, useModels, useDownloadProgress, useVersion, useVoiceAgent
- **Components**: Sidebar, FeatureDiscovery, PreFlightChecks, SetupWizard, SuccessValidation, TroubleshootingAssistant
- **Routing**: Core routes via plugin registry (extensible architecture)

---

## Critical Issues

### 1. Missing Test Coverage
- No test files found (`**/*.test.{js,jsx}` returns empty)
- The `dashboard-api` has a `tests/` directory but frontend has no tests
- No CI/CD test integration visible

### 2. Error Handling Gaps in Hooks
- `useModels.js`: `fetchModels` catches errors but UI may show stale data
- `useSystemStatus.js`: `USE_MOCK_DATA` flag leaks into production build (should be build-time, not runtime)
- `useDownloadProgress.js`: Silent failures on fetch errors (`catch` blocks with no user feedback)

### 3. Memory Leak Risk in useVoiceAgent
- Multiple audio elements are appended to `document.body` but cleanup only removes `audioElementRef.current`
- `audioElementsRef.current.push(audioElement)` adds elements, but `disconnect()` clears `audioElementRef.current` separately
- The cleanup loop iterates `audioElementsRef.current` but may miss orphaned elements

### 4. Race Conditions in Async Operations
- `useModels`: Multiple `fetchModels()` calls can race (no cancellation on unmount)
- `useDownloadProgress`: `startPolling` checks `pollRef.current` but `fetchProgress` races with interval
- `useOllama`: Pull status polling memory state (`_ollama_pull_status`) is server-side but cached in hook

### 5. Missing Input Validation
- `Settings.jsx`: `handleExportConfig` uses `blob:` URLs without revoking in error paths
- `Models.jsx`: `search` state has no XSS sanitization (though React handles this)
- Model IDs passed to API endpoints need validation (handled in backend, but UI should pre-validate)

---

## Medium Priority Issues

### 6. Performance Concerns
- `Dashboard.jsx`: `sortBySeverity` and `computeHealth` run on every render without memoization
- `Models.jsx`: `filteredModels` filter could be slow with large catalogs (no virtualization)
- `App.jsx`: `getInternalRoutes` called on every render with context object

### 7. Accessibility Issues
- Missing ARIA labels on interactive elements (buttons, links, inputs)
- `Voice.jsx`: No focus management for keyboard navigation
- No `aria-live` regions for dynamic content (download progress, toasts)
- Color contrast issues on muted text (`text-zinc-500` on dark backgrounds)

### 8. State Management Complexity
- `Models.jsx`: 600+ line component managing too much state (consider extracting)
- Toast and confirm dialog state in component could use context/store
- No global loading state pattern

### 9. TypeScript Migration Opportunity
- Large hooks with complex state (`useModels`, `useVoiceAgent`) would benefit from TS
- API responses have implicit shapes (could use generated types from backend)

### 10. Bundle Size
- `lucide-react` imports all icons; should use tree-shaking (`import { Icon } from 'lucide-react'`)
- No code splitting for large pages (Voice page with LiveKit SDK lazy-loaded correctly)

---

## Minor Issues

### 11. Code Style Inconsistencies
- Mixed arrow function styles (`const fn = () => {}` vs `function fn() {}`)
- Inconsistent error logging (some `console.error`, some silent)
- Magic numbers (poll intervals: `15000`, `30000`, `5000` should be constants)

### 12. Missing Features / Gaps

#### Voice Page
- Wake word detection referenced but not implemented properly (`wakeWord` state stored but unused)
- Push-to-talk mentioned in comments but only toggle implemented
- No voice activity detection (VAD) settings
- No conversation history persistence
- Audio quality settings hardcoded

#### Settings Page
- Update channel "not wired yet (v2.0)" - placeholder text visible to users
- No way to configure models from Settings
- No backup/restore functionality

#### Models Page
- No model comparison feature
- No batch operations (download multiple models)
- No model versioning visible
- Cloud provider "test connection" error messages could be more helpful
- No GPU recommendation for selected model

#### Dashboard Page
- No customizable layout/widgets
- No chart/graph for historical metrics (tokens over time, GPU utilization)
- FeatureDiscoveryBanner rendered twice (once in App.jsx, once in Dashboard.jsx)
- Services grid sorted by severity but no "jump to unhealthy" feature

### 13. Documentation Gaps
- No Storybook or component documentation
- `README.md` is minimal (no API conventions, no contributor guide)
- Complex hooks (`useVoiceAgent`) need JSDoc improvements

### 14. Configuration Issues
- `vite.config.js`: Dev server port `3001` hardcoded, should use env var
- API proxy target `localhost:3002` hardcoded
- No environment variable validation

---

## Backend Integration Issues

### 15. API Endpoint Gaps
- No `/api/features/enable` implementation visible (referenced in FeatureDiscovery)
- `/api/voice/token` endpoint required but voice status checked separately
- Bootstrap mode handling assumes `/api/status` returns `bootstrap` object

### 16. WebSocket / Real-time Missing
- Status polling every 5-30s is inefficient
- Download progress could use WebSocket instead of polling
- Voice uses LiveKit but no real-time updates for model loading status

---

## Recommended Actions

### High Priority
1. Add unit tests for hooks (`useModels`, `useSystemStatus`, `useDownloadProgress`)
2. Fix memory leak in `useVoiceAgent` audio element cleanup
3. Add abort controllers / cleanup for all async operations
4. Revoke blob URLs in error paths in `Settings.jsx`
5. Remove `USE_MOCK_DATA` or make it a build-time define

### Medium Priority
6. Add virtualization to Models list (`react-window` or `react-virtual`)
7. Create global state context for toast/confirm dialogs
8. Add ARIA labels and focus management throughout
9. Implement actual `handleCheckUpdates` in Settings (or remove button)
10. Add error boundaries per page

### Low Priority
11. Migrate to TypeScript for better type safety
12. Add Storybook for component documentation
13. Consider WebSocket for real-time updates
14. Add chart library for historical metrics
15. Implement customizable Dashboard layout
