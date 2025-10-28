# SOR Phase 2 - POC V2 (A* + Graph Memory + Indexer)

> **POC V2 Document** - Updated from [POC V1](https://docs.google.com/document/d/1bXMJpQ17We9prcEynCMQZGTNcx7uMEZCX-GcCuRJTW0/edit?usp=sharing)  
> **Core Changes:** Yen's → A\*, Marginal Analysis → Waterfill/Hillclimb, Reuse existing indexer
> 
> **Status:** Planning 📋  
> **Target:** Q1 2026  
> **Owner:** vkhoa@undercurrent.tech

---

## 📋 Table of Contents

1. [What Changed from POC V1](#what-changed-from-poc-v1)
2. [POC Goals](#poc-goals)
3. [Two Main Concerns](#two-main-concerns)
4. [Architecture Overview](#architecture-overview)
5. [Implementation Plan](#implementation-plan)
6. [Success Criteria](#success-criteria)
7. [References](#references)

---

## 🔄 What Changed from POC V1

| Component | POC V1 | POC V2 | Reason |
|-----------|--------|--------|--------|
| **Pathfinding** | Yen's K-Shortest Paths | **A\* Search** | Faster with heuristic |
| **Route Splitting** | Marginal Analysis | **Waterfill + Hillclimb** | More robust |
| **Indexer** | Not using | **Reuse existing** ✅ | Infrastructure exists |

---

## 🎯 POC Goals

### Success Criteria

```
Phase 1 Baseline (2 hops, single route):
  Input:  10,000 APT
  Output: 165,000 USDC (best single route)
  Price impact: 67% (severe slippage!)
  Graph updates: 100% of liquidity events (poor!)

Phase 2.1 Target (A* with 3-5 hops, single route):
  Input:  10,000 APT
  Output: 238,000 USDC (better path via A*)
  Price impact: 52%
  Improvement: +44% vs Phase 1 ✅
  Graph updates: 10% of liquidity events (excellent!) ✅

Phase 2.2 Target (A* with route splitting):
  Input:  10,000 APT
  Output: 463,000 USDC (multi-route optimized)
  Split: 20% Route 1 + 30% Route 2 + 50% Route 3
  Price impact: 8% (massive improvement!)
  Improvement: +180% vs Phase 1 🚀
  Graph updates: 10% of liquidity events ✅
```

---

## 🔧 Two Main Concerns

### **Concern 1: In-Memory Graph Management**

**Why In-Memory Graph?**
```
Fast routing requirement:
  - A* search needs graph structure
  - DB query too slow (~50-100ms per request)
  - Solution: Store graph in RAM (0.01ms access)
```

**Challenge:**
```
Blockchain state changes constantly
Question: WHEN to update graph?
```

**Design Decision:**
```
Use spot price based weights:
  - 90% of liquidity events → Graph unchanged (balanced adds)
  - 10% of events → Graph update (price changes)
  
Result: Graph is STABLE, rarely updates ✅
```

**Key Decisions:**
```
Weight formula options:
  - Approach 1: Pure spot price (no fee) → 10% update rate
  - Approach 3: Spot + fee + filtering → 15% update rate
  
Both viable! Pending final decision.
See: Weight Approaches Comparison doc
```

---

### **Concern 2: Block Indexer (Event Handler)**

> ⚠️ **Important:** Weight calculation strategy significantly affects how many events need to be listened to. See comparison table: [WEIGHT-APPROACHES-COMPARISON.md](./WEIGHT-APPROACHES-COMPARISON.md)

**Why Event Listener?**
```
Graph needs to stay synchronized with blockchain:
  - Pools created/disabled → Graph topology changes
  - Swaps/Liquidity changes → Pool reserves change
  - Solution: Listen to blockchain events, update graph
```

**Infrastructure Status:**
```
✅ Already exists!

Current System:
  ScBroadcaster: Streams blockchain events → Kafka
  OrderBookWorker: Consumes events for order book rebuild

Available events:
  ✅ PoolCreated
  ✅ LiquidityAdded (currently used)
  ✅ LiquidityRemoved (currently used)
  ✅ Swapped (currently used)
  ✅ CollectFee
```

**Design Decision:**
```
Selective graph updates (only when spot price changes):
  ✅ PoolCreated/Disabled: Update (topology changes)
  ✅ Swapped: Update (reserves shift → price changes)
  ✅ Imbalanced Add: Update (ratio changes)
  ❌ Balanced Add: NO update (price unchanged) - 90% case!
  
Result: 10-15% update rate (efficient!) ✅
```

**Future Consideration:**
```
For high traffic scenarios (many concurrent events):
  
  Problem:
    - Multiple events in 1 second → Multiple graph updates
    - Concurrency issues (race conditions)
    - Resource waste (update graph 10× vs 1×)
  
  Solution (Event Batching):
    1. Events → Kafka (already exists ✅)
    2. Buffer events in memory queue
    3. Batch process every 10 seconds
    4. Single graph update per batch
  
  Benefits:
    - Reduces update frequency (10 events → 1 update)
    - Avoids race conditions (single-threaded batch)
    - Better resource utilization
  
  ⚠️ Needs Discussion:
    Option A: Add as low-priority task in Phase 2
    Option B: Move to backlog (implement if traffic grows)
    
    Decision pending based on expected event volume.
```

**Implementation:**
```rust
// ✅ Infrastructure already exists! (verified)
File: tapp/backend/src/worker/order_book_worker.rs

async fn watch_transactions(self: &Arc<Self>) -> anyhow::Result<()> {
    // Existing: Consumes {env}.sc.events.completed
    let consumer = kafka_utils::new_consumer_from_latest_offset(...);
    
    worker_utils::consume_batches(
        consumer,
        |items: Vec<Value>| {
            async move {
                // Existing: Rebuild order books
                this.process_transactions(items.clone()).await?;
                
                // NEW (Task 4): Update graph
                this.update_graph_from_events(items).await?;  // ← Add this
                
                Ok(())
            }
        },
    ).await
}
```

**See:** 
- [Graph Update Strategy](./GRAPH-UPDATE-STRATEGY.md) - Update logic details

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│              Phase 2 Architecture                    │
└─────────────────────────────────────────────────────┘

Blockchain Events (✅ Already streaming)
    │
    ▼
ScBroadcaster (✅ Exists)
    │ Stream via Aptos Indexer gRPC
    ▼
Kafka: {env}.sc.events.completed (✅ Exists)
    │
    ▼
OrderBookWorker.watch_transactions() (✅ Exists)
    │
    ├─► Rebuild order books (existing)
    └─► Update in-memory graph (NEW - Task 4) ⭐

Input: Token A → Token B, Amount
    ↓
┌─────────────────────────────────────────────────────┐
│  LAYER 1: IN-MEMORY GRAPH (Routing) - Task 3       │
│  - A* Search finds top K paths                      │
│  - Stored in OrderBookWorker RAM                    │
│  - Weight = -log10(spotPrice)                       │
│  - Update: RARE (10% events)                        │
└─────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────┐
│  LAYER 2: CAPACITY (Splitting - Phase 2.2) - Task 6│
│  - Waterfill / Hillclimb optimization               │
│  - Update: FREQUENT (100% events)                   │
└─────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────┐
│  LAYER 3: ORDER BOOK GENERATOR                      │
│  - Generate entries (price ladder)                  │
│  - Output: { routeMatrix, entries }                 │
└─────────────────────────────────────────────────────┘
```

### **Key Components:**

| Component | Purpose | Update Frequency | Status |
|-----------|---------|------------------|--------|
| **Graph** | Store routing structure (in RAM) | 10-15% events | Task 3 |
| **Heuristic** | A* speedup (Reverse Dijkstra) | 10-15% events | Task 3.5 |
| **Capacity** | Pool states for slippage | 100% events | Task 6 |
| **Block Indexer** | Listen & update graph | Always running | ✅ Exists (Task 4) |

**See detailed implementation:**
- [Graph Update Strategy](./GRAPH-UPDATE-STRATEGY.md) - Event handling logic
- [Weight Approaches Comparison](./WEIGHT-APPROACHES-COMPARISON.md) - Weight formula options

---

## 📅 Implementation Plan

### **Phase 2.1: A\* Search + In-Memory Graph (34 pts)**

**Core Tasks:**
```
Task 1: Implement A* Algorithm (8 pts)
  - Add feature flag for fast testing
  - Implement A* search with spot price weights
  - Unuse chunking for 3+ hops (if feature flag ON or hops >= 3)
  - NO frontend changes (backend returns same output format)
  
  Why feature flag?
  → Logic switch DFS→A* is QUICK (if/else)
  → Ship to production FASTER (flag OFF = safe)
  → No need to wait for Task 2 (est-swap3 channel)
  → Can work in PARALLEL with Task 2
  → Toggle flag to test A* with real traffic
  
Task 2: Create est-swap3 Channel (5 pts)
  - New channel for SOR V2
  - Remove feature flag from est-swap2
  - Clean architecture separation
  
Task 3: In-Memory Graph (8 pts)
  - Graph builder with weight calculation
  - Store in OrderBookWorker RAM
  - Fast access for A* search
  
Task 4: Block Indexer (5 pts) ✅ Infrastructure exists
  - Add graph update to existing OrderBookWorker.watch_transactions()
  - Update graph on PoolCreated, Swapped, Liquidity events
  
Task 3.5, 4.5, 5: Optional optimizations (8 pts)
```

**Frontend Impact:** ✅ **NO CHANGES** (response format identical to est-swap2)

**See:** [IMPLEMENTATION-TASKS-BREAKDOWN.md](./IMPLEMENTATION-TASKS-BREAKDOWN.md) for detailed breakdown

---

### **Phase 2.2: Route Splitting (36 pts)**

**Core Tasks:**
```
Task 6: Route Splitting Algorithms (13 pts)
  - Capacity manager (separate from graph)
  - Waterfill implementation
  - Hillclimb implementation
  
Task 7: Update est-swap3 Response (5 pts)
  - Add splits field to response
  - Backend + Display engine DTOs
  
Task 8: Frontend Update (5 pts)
  - Handle splits field
  - Update EstSwap2Handler
  - Update serializeSOR for multiple routes
  
Task 9: Testing (13 pts)
  - Comprehensive testing & validation
```

**Frontend Impact:** ⚠️ **REQUIRES CHANGES** (new `splits` field handling)

**See:** [IMPLEMENTATION-TASKS-BREAKDOWN.md](./IMPLEMENTATION-TASKS-BREAKDOWN.md) for detailed breakdown

---

## ✅ Success Criteria

### **Phase 2.1 (A\* Search):**

```
Performance:
  ✅ A* search: <50ms (top 5 paths, 3-5 hops)
  ✅ Graph updates: 10-15% event rate
  
Output Quality:
  ✅ +20-40% improvement vs Phase 1 (better paths)
  
Response Format:
  ✅ Same as Phase 1 (frontend unchanged)
```

### **Phase 2.2 (Route Splitting):**

```
Performance:
  ✅ Waterfill/Hillclimb: <50-100ms
  ✅ Total pipeline: <200ms
  
Output Quality:
  ✅ +50-180% improvement for large orders
  ✅ Price impact: <10% (vs 67% Phase 1)
  
Response Format:
  ⚠️ Updated with splits array (minor frontend update)
```

---

## 📚 References

### **Core Documents (MUST READ):**

1. **[Graph Update Strategy](./GRAPH-UPDATE-STRATEGY.md)** ⭐
   - Event handling logic to add
   - WHEN to update graph
   - Batching strategies

2. **[Weight Approaches Comparison](./WEIGHT-APPROACHES-COMPARISON.md)** ⭐
   - 3 approaches compared
   - Weight change simulation
   - Performance analysis

### **Supporting Documents:**
- [Chunking Removal](./CHUNKING-REMOVAL-EXPLANATION.md) - Why Phase 1 chunking removed

### **Working Code Reference:**

- `phase1-astar-mike.js` - A* implementation (in root folder)
- `phase2-waterfill.js` - Waterfill splitting (in root folder)
- `phase2-hillclimb.js` - Hillclimb splitting (in root folder)

---

**Document Version:** 2.0  
**Last Updated:** October 28, 2025  
**Status:** Planning - Pending weight approach decision (1 vs 3)

