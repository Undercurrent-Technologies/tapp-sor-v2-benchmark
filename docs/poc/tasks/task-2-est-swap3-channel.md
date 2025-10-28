# Task 2: Create est-swap3 Channel (Clean Architecture)

> **Story Points:** 5 (Medium)  
> **Priority:** 🔴 CRITICAL  
> **Depends:** Task 1 (need A* implementation & feature flag testing)  
> **Phase:** 2.1

---

## 🎯 Goal

Create new channel `est-swap3` for SOR V2 (clean version using A*) and remove feature flag from `est-swap2` (back to Phase 1 DFS).

---

## 📊 Strategy: Feature Flag → Channel Versioning

```
Task 1 (Temporary):
  est-swap2 + FEATURE_FLAG_SOR_V2
  ✅ Fast testing in production
  ❌ Feature flag = technical debt
  ❌ if/else branching in code

Task 2 (Permanent):
  est-swap2 (remove flag) = Phase 1 DFS only
  est-swap3 (new) = Phase 2 A* only
  ✅ Clean separation (no flag needed)
  ✅ Channel = version toggle
  ✅ No code branching
  ✅ Easy A/B test (switch channel)
  ✅ Easy rollback (use old channel)
  ✅ Both run simultaneously

Timeline:
  1. Task 1 deployed → Test with feature flag
  2. After validation → Task 2 creates est-swap3
  3. Remove feature flag from est-swap2
  4. Result: Clean architecture!
```

---

## 📋 Subtasks

### **Overview: Clone Pattern**

```
est-swap3 is essentially a VERSION CLONE of est-swap2:
  - Same architecture (Backend → Display Engine → Frontend)
  - Same Kafka topics pattern ({env}.sc.est-swap3.subs / .notify)
  - Same WebSocket flow
  - Same response format
  
ONLY DIFFERENCE:
  - est-swap2: Uses DFS (Phase 1)
  - est-swap3: Uses A* from Task 1 (Phase 2)
```

---

### **2.1. Backend - Clone est-swap2 Handler for est-swap3**

**Dependencies:** Task 1 (need A* functions)

#### Implementation Guide:

```rust
File: tapp/backend/src/worker/order_book_worker.rs

Pattern: Clone est-swap2 functions → est-swap3 functions

1. Clone watch_active_requests() → watch_active_requests_v3()
   - Change Kafka topic: est-swap2.subs → est-swap3.subs

2. Clone process_active_requests() → process_active_requests_v3()
   - Change routing: find_all_routes_dfs() → find_all_routes_astar()
   - Change entries: build_order_book_entries() → build_order_book_entries_v3()
   - Change output topic: est-swap2.notify → est-swap3.notify

3. Update start() to run both consumers in parallel

Result: Both channels run independently with different algorithms
```

**Deliverable:** Backend handles est-swap3 topic

---

### **2.2. Display Engine - Clone est-swap2 Routes & Handlers**

**Dependencies:** Task 2.1

#### Implementation Guide:

```go
Pattern: Clone all est-swap2 components → est-swap3 components

Files to update:
  1. services/subscription/ws.go
     - Add route: "est-swap3" → SubscribeScEstSwap3()
     
  2. services/sc/ws.go
     - Clone: SubscribeScEstSwap2() → SubscribeScEstSwap3()
     
  3. internal/sc/sc.go
     - Clone: GetScEstSwap2() → GetScEstSwap3()
     - Clone: OnEstSwap2Notification() → OnEstSwap3Notification()

Changes needed:
  - Channel names: est-swap2 → est-swap3
  - Kafka topics: est-swap2.subs/.notify → est-swap3.subs/.notify
  - Cache keys: "est-swap2:..." → "est-swap3:..."

Note: Logic is IDENTICAL, just different channel/topic names
```

**Deliverable:** Display engine routes & handlers for est-swap3

---

### **2.3. Frontend - Add Channel Version Toggle**

**Dependencies:** Task 2.2

#### Implementation Guide:

```typescript
File: tapp/frontend/src/components/swap/hooks/use-sor.ts

Change: Add version parameter to channelName() function
  - version?: 2 | 3  (default = 2)
  - IF version === 3 → use "est-swap3"
  - ELSE              → use "est-swap2"

Usage:
  version: 2 → Subscribe to "sc.est-swap2.APT-USDC" (DFS)
  version: 3 → Subscribe to "sc.est-swap3.APT-USDC" (A*)
```

**Deliverable:** Frontend can toggle between est-swap2 and est-swap3

---

### **2.4. Remove Feature Flag from est-swap2**

**Dependencies:** Task 2.3

#### Implementation Guide:

```rust
File: tapp/backend/src/worker/order_book_worker.rs

Change: Remove feature flag IF/ELSE from process_active_requests()
  - Always use: find_all_routes_dfs() (Phase 1 DFS)
  - Always use: build_order_book_entries() (with chunking)

File: tapp/backend/src/config.rs

Remove: feature_flag_sor_v2 field (no longer needed)

Reason:
  - est-swap2 = Phase 1 (stable, production)
  - est-swap3 = Phase 2 (new, A*)
  - Use channel versioning instead of feature flags!
```

**Deliverable:** Feature flag removed, clean architecture

---

### **2.5. Testing**

**Dependencies:** All of Task 2

#### Test Cases:

```bash
Test both channels independently:
  - version=2 → est-swap2 → Uses DFS (Phase 1)
  - version=3 → est-swap3 → Uses A* (Phase 2)

Verify:
  ✅ Response format SAME for both channels
  ✅ Output quality better with A* (est-swap3)
  ✅ Both channels run in parallel
  ✅ No feature flags in code
  ✅ Easy A/B testing (just switch version)
```

**Deliverable:** Both channels working, clean separation

---

## 📚 Related Documents

---

## ✅ Definition of Done

- [ ] Backend: est-swap3 handler cloned from est-swap2 (uses A*)
- [ ] Display Engine: est-swap3 routes & handlers added
- [ ] Frontend: Channel version toggle (2 or 3)
- [ ] Feature flag removed from est-swap2
- [ ] est-swap2 = Phase 1 (DFS only)
- [ ] est-swap3 = Phase 2 (A* only)
- [ ] Both channels work independently
- [ ] A/B testing validated
- [ ] Code reviewed

---

**Back to:** [Implementation Overview](../IMPLEMENTATION-TASKS-BREAKDOWN.md)

