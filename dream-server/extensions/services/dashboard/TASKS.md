# Dashboard Task Tracker

**Created:** 2026-03-12
**Source:** [DASHBOARD_REVIEW.md](./DASHBOARD_REVIEW.md)

---

## Status Legend

- 🔴 **Critical** - Must fix before production
- 🟡 **Medium** - Should fix soon
- 🟢 **Low** - Nice to have / future work
- ⬜ **Todo** - Not started
- 🔄 **In Progress** - Work started
- ✅ **Done** - Completed
- ❌ **Blocked** - Cannot proceed

---

## Critical Issues

### Testing

| ID | Task | Priority | Status | Assignee | Notes |
|----|------|----------|--------|----------|-------|
| C1 | Add unit tests for `useModels` hook | 🔴 | ✅ | | Jest/Vitest setup needed |
| C2 | Add unit tests for `useSystemStatus` hook | 🔴 | ✅ | | |
| C3 | Add unit tests for `useDownloadProgress` hook | 🔴 | ✅ | | |
| C4 | Add CI/CD test integration | 🔴 | ⬜ | | GitHub Actions workflow |

### Bugs

| ID | Task | Priority | Status | Assignee | Notes |
|----|------|----------|--------|----------|-------|
| C5 | Fix memory leak in `useVoiceAgent` audio cleanup | 🔴 | ✅ | | Audio elements orphaned |
| C6 | Add abort controllers to `useModels` fetch | 🔴 | ✅ | | Race condition on unmount |
| C7 | Add abort controllers to `useDownloadProgress` | 🔴 | ✅ | | Polling cleanup |
| C8 | Revoke blob URLs in `Settings.jsx` error paths | 🔴 | ✅ | | Memory leak potential |
| C9 | Fix `USE_MOCK_DATA` build-time check | 🔴 | ✅ | | Added abort controllers |

---

## Medium Priority

### Performance

| ID | Task | Priority | Status | Assignee | Notes |
|----|------|----------|--------|----------|-------|
| M1 | Memoize `sortBySeverity` in Dashboard.jsx | 🟡 | ✅ | | Use `useMemo` with WeakMap |
| M2 | Memoize `computeHealth` in Dashboard.jsx | 🟡 | ✅ | | Use `useMemo` with WeakMap |
| M3 | Add virtualization to Models list | 🟡 | ⬜ | | Use `react-window` |
| M4 | Memoize `getInternalRoutes` result in App.jsx | 🟡 | ✅ | | |

### Accessibility

| ID | Task | Priority | Status | Assignee | Notes |
|----|------|----------|--------|----------|-------|
| M5 | Add ARIA labels to all buttons | 🟡 | ⬜ | | |
| M6 | Add ARIA labels to all inputs | 🟡 | ⬜ | | |
| M7 | Add `aria-live` regions for dynamic content | 🟡 | ⬜ | | Download progress, toasts |
| M8 | Add focus management in Voice page | 🟡 | ⬜ | | Keyboard navigation |
| M9 | Fix color contrast issues | 🟡 | ⬜ | | `text-zinc-500` on dark |

### Architecture

| ID | Task | Priority | Status | Assignee | Notes |
|----|------|----------|--------|----------|-------|
| M10 | Create global toast context | 🟡 | ✅ | | `src/contexts/ToastContext.jsx` |
| M11 | Create global confirm dialog context | 🟡 | ✅ | | `src/contexts/ConfirmContext.jsx` |
| M12 | Add error boundaries per page | 🟡 | ⬜ | | |
| M13 | Refactor Models.jsx into smaller components | 🟡 | ⬜ | | 600+ lines is too large |

---

## Low Priority

### Code Quality

| ID | Task | Priority | Status | Assignee | Notes |
|----|------|----------|--------|----------|-------|
| L1 | Migrate to TypeScript | 🟢 | ⬜ | | Large effort |
| L2 | Add Storybook | 🟢 | ⬜ | | Component documentation |
| L3 | Extract magic numbers to constants | 🟢 | ⬜ | | Poll intervals, etc. |
| L4 | Fix `handleCheckUpdates` or remove button | 🟢 | ⬜ | | Settings page |

### Features

| ID | Task | Priority | Status | Assignee | Notes |
|----|------|----------|--------|----------|-------|
| L5 | Add WebSocket for real-time updates | 🟢 | ⬜ | | Replace polling |
| L6 | Add chart library for metrics | 🟢 | ⬜ | | GPU utilization history |
| L7 | Implement customizable Dashboard layout | 🟢 | ⬜ | | Drag/drop widgets |
| L8 | Add model comparison feature | 🟢 | ⬜ | | Models page |
| L9 | Add batch model download | 🟢 | ⬜ | | Models page |
| L10 | Implement backup/restore in Settings | 🟢 | ⬜ | | |
| L11 | Add voice conversation history persistence | 🟢 | ⬜ | | Voice page |
| L12 | Fix duplicate FeatureDiscoveryBanner | 🟢 | ⬜ | | Dashboard.jsx |

### Configuration

| ID | Task | Priority | Status | Assignee | Notes |
|----|------|----------|--------|----------|-------|
| L13 | Make dev server port configurable | 🟢 | ⬜ | | vite.config.js |
| L14 | Make API proxy target configurable | 🟢 | ⬜ | | vite.config.js |
| L15 | Add environment variable validation | 🟢 | ⬜ | | Runtime validation |

---

## Documentation

| ID | Task | Priority | Status | Assignee | Notes |
|----|------|----------|--------|----------|-------|
| D1 | Improve README.md | 🟢 | ⬜ | | Add API conventions |
| D2 | Add JSDoc to complex hooks | 🟢 | ⬜ | | `useVoiceAgent`, `useModels` |
| D3 | Add contributor guide | 🟢 | ⬜ | | |

---

## Progress Summary

| Priority | Total | Done | In Progress | Todo |
|----------|-------|------|-------------|------|
| Critical | 9 | 9 | 0 | 0 |
| Medium | 13 | 4 | 0 | 9 |
| Low | 15 | 0 | 0 | 15 |
| Docs | 3 | 0 | 0 | 3 |
| **Total** | **40** | **13** | **0** | **27** |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-03-12 | Initial task list created from DASHBOARD_REVIEW.md |
| 2026-03-12 | Completed: C1-C9 (Testing infrastructure + Critical bug fixes) |
| 2026-03-12 | Completed: M1-M4 (Performance optimizations) |
| 2026-03-12 | Completed: M10-M11 (Global toast and confirm contexts) |
