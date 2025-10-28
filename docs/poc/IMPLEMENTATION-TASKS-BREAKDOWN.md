# SOR Phase 2 - Implementation Tasks Breakdown

> **Overview of implementation tasks with links to detailed specs**
> 
> Last Updated: October 28, 2025  
> Status: Planning

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Tasks Summary](#tasks-summary)
3. [Critical Questions](#critical-questions)
4. [Timeline & Dependencies](#timeline--dependencies)
5. [Summary](#summary)
6. [Related Documents](#related-documents)

---

## 🎯 Overview

### **Phase 2.1 Goal:**
Replace DFS with A* search, add in-memory graph, block indexer (listen events to update graph), remove chunking (for 3+ hops)

**Key Point:** ✅ **NO FRONTEND CODE CHANGES** (response format stays the same)

### **Phase 2.2 Goal:**
Add route splitting (Waterfill/Hillclimb) to reduce price impact for large orders

**Key Point:** ⚠️ **REQUIRES FRONTEND CODE CHANGES** (new `splits` field in response)

### **Key Strategy:**
2-phase approach: **Feature flag for fast testing** → **Channel versioning for clean architecture**

```
Phase 1 (Task 1): Temporary - Feature Flag
  est-swap2 + FEATURE_FLAG_SOR_V2
  ✅ Fast release to production (flag OFF)
  ✅ Turn flag ON to test A* with real traffic
  ✅ Easy rollback (flag OFF)

Phase 2 (Task 2): Permanent - Channel Versioning
  est-swap2 = Phase 1 (DFS, remove feature flag)
  est-swap3 = Phase 2 (A* + route splitting)
  ✅ Channel = Version toggle (cleaner than flag)
  ✅ A/B testing built-in (switch channels)
  ✅ Clean code (no if/else branching)
```

---

## 📋 Tasks Summary

### **Effort Measurement:**
**Using Story Points** (Fibonacci scale) - allows dev team self-estimation:
- **1-2**: Trivial/Simple
- **3**: Easy
- **5**: Medium
- **8**: Complex
- **13**: Very Complex

**Velocity Assumption:** 15-20 points/week (adjust based on team)

---

### **Phase 2.1: A\* Search + In-Memory Graph (SOR V2)**

| # | Task | Story Points | Priority | Description | Details |
|---|------|--------------|----------|-------------|---------|
| **1** | **Implement A\* Algorithm** | 8 | 🔴 CRITICAL | Add feature flag + Implement A*, remove chunking (fast release) | [→ View Details](./tasks/task-1-astar-algorithm.md) |
| **2** | **Create est-swap3 Channel** | 5 | 🔴 CRITICAL | New channel for SOR V2, remove feature flag from est-swap2 | [→ View Details](./tasks/task-2-est-swap3-channel.md) |
| **3** | **In-Memory Graph** | 8 | 🟡 HIGH | Build & cache graph for fast routing | [→ View Details](./tasks/task-3-in-memory-graph.md) |
| **3.5** | **Heuristic Cache** | 3 | 🟢 MEDIUM | Pre-compute for 5-10× A* speedup (optional) | [→ View Details](./tasks/task-3.5-heuristic-cache.md) |
| **4** | **Block Indexer (Event Listener)** | 5 | 🟡 HIGH | Listen blockchain events, update in-memory graph | [→ View Details](./tasks/task-4-event-listener.md) ⭐ |
| **4.5** | **Graph Persistence** | 3 | 🟢 LOW | Save/load graph for fast restart (optional) | [→ View Details](./tasks/task-4.5-graph-persistence.md) |
| **5** | **Monitoring** | 2 | 🟡 MEDIUM | Metrics & alerts (recommended) | [→ View Details](./tasks/task-5-monitoring.md) |

**Total Phase 2.1:** 34 points → **2-3 weeks** (at 16 pts/week velocity)

**Update:** Task 4 verified as 5 pts (event pipeline exists) ✅

**Note:** 
- est-swap3 = SOR V2, NOT just for route splitting!  
- Clean separation: est-swap2 (Phase 1) vs est-swap3 (Phase 2)
- **✅ NO FRONTEND CHANGES** - Response format identical to est-swap2
- Includes: A* algorithm, in-memory graph, block indexer (event listener)

---

### **Phase 2.2: Route Splitting**

| # | Task | Story Points | Priority | Description | Details |
|---|------|--------------|----------|-------------|---------|
| **6** | **Route Splitting Algorithms** | 13 | 🔴 CRITICAL | Waterfill & Hillclimb implementation | [→ View Details](./tasks/task-6-route-splitting.md) |
| **7** | **Update est-swap3 Response** | 5 | 🔴 CRITICAL | Add splits field to existing est-swap3 | [→ View Details](./tasks/task-7-update-response.md) |
| **8** | **Frontend Update** | 5 | 🔴 CRITICAL | Handle splits field in response | [→ View Details](./tasks/task-8-frontend-update.md) |
| **9** | **Testing All Flow** | 13 | 🟡 HIGH | Comprehensive testing & validation | [→ View Details](./tasks/task-9-testing.md) |

**Total Phase 2.2:** 36 points → **2-3 weeks** (at 16 pts/week velocity)

**Note:** 
- Update existing est-swap3 (from Phase 2.1), NOT create new channel!
- **⚠️ REQUIRES FRONTEND CHANGES** - New `splits` field in response format
- Backend, display engine, and frontend ALL need updates

---

### **Task Dependencies Diagram:**

```
Phase 2.1: ✅ NO FRONTEND CHANGES
  Task 1 (Add Feature Flag + Implement A* Algorithm)
    └─→ Deploy to prod (flag OFF) → Test (flag ON) ✅ Fast feedback!
    └─→ Task 2 (Create est-swap3 Channel - clean version, remove flag from est-swap2)
          ├─→ Task 3 (In-Memory Graph)
          │     ├─→ Task 3.5 (Heuristic Cache)
          │     ├─→ Task 4 (Block Indexer - listen events, update graph)
          │     │     └─→ Task 4.5 (Graph Persistence)
          │     └─→ Task 5 (Monitoring)
          └─→ Deploy est-swap3 (Phase 2.1 complete, remove flag)
          
  Response format: IDENTICAL to est-swap2 ✅

Phase 2.2: ⚠️ REQUIRES FRONTEND CHANGES
  Task 6 (Route Splitting Algorithms)
    └─→ Task 7 (Update est-swap3 Response - add splits field)
          └─→ Task 8 (Frontend Update - handle splits)
                └─→ Task 9 (Testing)
                
  Response format: NEW splits field ⚠️
```

**Key Insight:** 
- **Task 1 (Fast Release)**: Feature flag in est-swap2 for quick testing
- **Task 2 (Clean Architecture)**: New channel est-swap3, remove flag from est-swap2
- **Strategy**: Temporary flag → Permanent channel versioning

---

## ⚠️ Critical Questions

**MUST ANSWER BEFORE STARTING:**

### **Question 1: Event Listener** ✅ **VERIFIED**

```
✅ CONFIRMED: Event pipeline EXISTS!

Findings:
  ✅ Kafka topic: {env}.sc.events.completed
  ✅ Backend consumer: OrderBookWorker.watch_transactions() (Line 220-272)
  ✅ Events available:
     - PoolCreated ✅
     - LiquidityAdded ✅ (currently used)
     - LiquidityRemoved ✅ (currently used)
     - Swapped ✅ (currently used)
     - CollectFee ✅
  ✅ Event payload includes: pool_id, reserve_a, reserve_b
  
Result: Task 4 = 5 pts ✅ (just add graph update logic)

See: EVENT-LISTENER-TRACE.md for full trace
```

**Action:** ✅ No action needed - proceed with 5 pts estimate

---

### **Question 2: Weight Approach**

```
Choose: Approach 1 (pure spot) or Approach 3 (spot + fee)?

Approach 1: 10% update rate, no fee
Approach 3: 15% update rate, includes fee (RECOMMENDED)

Decision needed for: Task 3 (In-Memory Graph)
See: WEIGHT-APPROACHES-COMPARISON.md
```

**Action:** Review weight approaches doc and decide before Task 3

---

## 📅 Timeline & Dependencies

### **Velocity Assumption:** 16 points/week

---

### **Phase 2.1: 2-3 weeks (34 points - verified ✅)**

#### **Sprint 1 (Week 1): 16 points**

```
✅ Task 1: A* Algorithm (8 pts)
✅ Task 2: Create est-swap3 Channel (5 pts)
✅ Task 3: In-Memory Graph - Start (3 pts partial)

Total: 16 pts
Critical Path: Task 1 → Task 2
```

---

#### **Sprint 2 (Week 2): 15 points**

```
✅ Task 3: In-Memory Graph - Complete (5 pts)
✅ Task 3.5: Heuristic Cache (3 pts) [optional]
✅ Task 4: Block Indexer (5 pts) ⭐ VERIFIED
✅ Task 5: Monitoring (2 pts)

Total: 15 pts
Note: Task 4 = 5 pts ✅ (event pipeline exists!)
      Sprint finishes early - use buffer for testing
```

---

#### **Sprint 3 (Week 3): Integration & Deployment**

```
✅ Integration testing
✅ Performance validation
✅ Deploy est-swap3 (channel toggle)
✅ Gradual rollout:
   - 5% traffic (monitor 24h)
   - 25% traffic (monitor 24h)
   - 50% traffic (monitor 24h)
   - 100% traffic

Rollback: Switch back to est-swap2 channel (instant!)
```

---

### **Phase 2.2: 2-3 weeks (36 points)**

#### **Sprint 4 (Week 4): 16-20 points**

```
✅ Task 6: Route Splitting (13 pts)
✅ Task 7: Update est-swap3 Response (5 pts partial)

Total: 18 pts (3 pts spills to Sprint 5)
Critical Path: Task 6 → Task 7
```

---

#### **Sprint 5 (Week 5): 16-20 points**

```
✅ Task 7: Complete (2 pts)
✅ Task 8: Frontend Update (5 pts)
✅ Task 9: Testing - Start (9 pts)

Total: 16 pts (4 pts spills to Sprint 6)
Critical Path: Task 7 → Task 8 → Task 9
```

---

#### **Sprint 6 (Week 6): Deployment**

```
✅ Task 9: Testing - Complete (4 pts)
✅ Deploy updated est-swap3 (with splits)
✅ Monitor & validate
✅ Announce to users (better prices!)

Total: 4 pts + deployment
```

---

## 📊 Summary

### **Phase 2.1 Tasks:**

| Task | Priority | Story Points | Description | Dependencies | Can Parallel? |
|------|----------|--------------|-------------|--------------|---------------|
| **1. A\* Algorithm** | 🔴 CRITICAL | 8 | Add feature flag + A* (fast release) | None | ❌ Blocks Task 2 |
| **2. Create est-swap3** | 🔴 CRITICAL | 5 | New channel, remove flag from est-swap2 | Task 1 | ❌ Blocks Phase 2.1 |
| **3. In-Memory Graph** | 🟡 HIGH | 8 | Build & cache graph | Task 1, 2 | ⚠️ Partial |
| **3.5. Heuristic Cache** | 🟢 MEDIUM | 3 | Pre-compute for A* speedup | Task 3 | ✅ Yes |
| **4. Block Indexer** | 🟡 HIGH | 5 | Listen events, update graph | Task 3 | ✅ Yes |
| **4.5. Graph Persist** | 🟢 LOW | 3 | Save/load graph | Task 4 | ✅ Yes |
| **5. Monitoring** | 🟡 MEDIUM | 2 | Metrics & alerts | Task 1,2,3 | ✅ Yes |

**Total:** 34 points → **2-3 weeks** (at 16 pts/week velocity)

**Update:** All tasks verified, no uncertainty ✅

---

### **Phase 2.2 Tasks:**

| Task | Priority | Story Points | Description | Dependencies | Can Parallel? |
|------|----------|--------------|-------------|--------------|---------------|
| **6. Route Splitting** | 🔴 CRITICAL | 13 | Waterfill & Hillclimb algorithms | Task 1, 2 | ❌ Blocking |
| **7. Update est-swap3 Response** | 🔴 CRITICAL | 5 | Add splits field | Task 6 | ❌ Blocking |
| **8. Frontend Update** | 🔴 CRITICAL | 5 | Handle splits in UI | Task 7 | ❌ Blocking |
| **9. Testing All Flow** | 🟡 HIGH | 13 | Comprehensive testing | All | ❌ Blocking |

**Total:** 36 points → **2-3 weeks** (at 16 pts/week velocity)

---

### **Critical Path:**

```
Sprint 1 (Week 1): 16 pts
  Task 1 (8 pts) → Task 2 (5 pts) → Task 3 start (3 pts)

Sprint 2 (Week 2): 16-23 pts
  Task 3 complete (5 pts) + Task 3.5 (3 pts) + Task 4 (5-13 pts) + Task 5 (2 pts)
  Note: Task 4 effort MUST BE VERIFIED (impacts timeline!)

Sprint 3 (Week 3):
  Integration testing + Deployment + Gradual rollout

Sprint 4 (Week 4): 18 pts
  Task 6 (13 pts) → Task 7 start (5 pts)

Sprint 5 (Week 5): 16 pts
  Task 7 complete (2 pts) → Task 8 (5 pts) → Task 9 start (9 pts)

Sprint 6 (Week 6): 4 pts
  Task 9 complete (4 pts) + Deployment
```

**Total: 5 weeks** (70 story points - verified ✅)

---

### **Effort Summary:**

**Measured in Story Points:**
```
Phase 2.1:
  Critical path: Task 1 → Task 2 → Task 3 (21 pts)
  Block indexer: Task 4 (5 pts) ✅ VERIFIED
  Optional tasks: Task 3.5, 4.5 (6 pts)
  Monitoring: Task 5 (2 pts)
  Total: 34 points ✅

Phase 2.2:
  Sequential path: Task 6 → Task 7 → Task 8 → Task 9 (36 pts)
  Total: 36 points

Grand Total: 70 story points (5 weeks at 16 pts/week) ✅ VERIFIED
```

**Velocity Conversion Examples:**
```
Junior team (10 pts/week): 7 weeks
Mid-level team (16 pts/week): 5 weeks ← Assumed
Senior team (25 pts/week): 3 weeks
```

---

## 📚 Related Documents

### **Task Details:**
- **Phase 2.1:**
  - [Task 1: A* Algorithm](./tasks/task-1-astar-algorithm.md)
  - [Task 2: est-swap3 Channel](./tasks/task-2-est-swap3-channel.md)
  - [Task 3: In-Memory Graph](./tasks/task-3-in-memory-graph.md)
  - [Task 3.5: Heuristic Cache](./tasks/task-3.5-heuristic-cache.md)
  - [Task 4: Event Listener](./tasks/task-4-event-listener.md)
  - [Task 4.5: Graph Persistence](./tasks/task-4.5-graph-persistence.md)
  - [Task 5: Monitoring](./tasks/task-5-monitoring.md)

- **Phase 2.2:**
  - [Task 6: Route Splitting](./tasks/task-6-route-splitting.md)
  - [Task 7: Update Response](./tasks/task-7-update-response.md)
  - [Task 8: Frontend Update](./tasks/task-8-frontend-update.md)
  - [Task 9: Testing](./tasks/task-9-testing.md)

### **Code References:**
- `tapp-sor-v2-benchmark/phase1-astar-mike.js` - A* reference implementation
- `tapp-sor-v2-benchmark/phase2-waterfill.js` - Waterfill reference
- `tapp-sor-v2-benchmark/phase2-hillclimb.js` - Hillclimb reference

---

**Document Version:** 2.0  
**Last Updated:** October 28, 2025  
**Status:** In Review

