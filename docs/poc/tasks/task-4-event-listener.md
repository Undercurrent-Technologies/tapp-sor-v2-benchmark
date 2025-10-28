# Task 4: Block Indexer (Event Listener & Graph Updates)

> **Story Points:** 5-13 (VERIFY)  
> **Priority:** ⚠️ CRITICAL TO VERIFY  
> **Depends:** Task 3 (in-memory graph)  
> **Phase:** 2.1

---

## 🎯 Goal

Listen to blockchain events and update in-memory graph when pool state changes (block indexer)

---

## ✅ VERIFIED - Event Listener EXISTS!

```
✅ Kafka topic: {env}.sc.events.completed
✅ Backend consumes: OrderBookWorker.watch_transactions() (Line 220-272)
✅ Events available:
   ✅ PoolCreated        (constants.rs:1)
   ✅ LiquidityAdded     (constants.rs:2) - Currently used
   ✅ LiquidityRemoved   (constants.rs:3) - Currently used
   ✅ Swapped            (constants.rs:5) - Currently used
   ✅ CollectFeeEvent    (constants.rs:4)
   ❓ PoolDisabled       (not found - may not exist in SC)
   ❓ FeeUpdated         (not found - may not exist in SC)

Result: Task 4 = 5 pts (Simple) ✅
  → Just add graph update logic to existing handler
  → Event pipeline already exists!
```


---

## 📋 Subtasks

### **4.1. Add graph_cache to OrderBookWorker**

#### Implementation Guide:

```rust
File: tapp/backend/src/worker/order_book_worker.rs

// Purpose: Already done in Task 3.4
// This subtask is DUPLICATE - can skip or mark as done
//
// Worker already has:
//   - graph_cache: Arc<RwLock<Option<Graph>>>
//   - Initialized in new()
```

**Deliverable:** Worker has graph cache field (already in Task 3.4)

---

### **4.2. Add PoolCreated to Event Filter**

#### Implementation Guide:

```rust
File: tapp/backend/src/worker/order_book_worker.rs
Location: watch_transactions() ~Line 233-240

// Purpose: Listen to PoolCreated events for graph updates
// 
// Current filter: ADD_LIQUIDITY, REMOVE_LIQUIDITY, SWAP
// Add: CREATED_POOL_EVENT
//
// Why: New pools = new edges in graph
//      Need to update graph when pool created

Change: Add CREATED_POOL_EVENT to event filter array
```

**Deliverable:** Filter includes PoolCreated events

---

### **4.3. Add Graph Update Handler**

#### Implementation Guide:

```rust
File: tapp/backend/src/worker/order_book_worker.rs
Location: watch_transactions() function

// Purpose: Add graph update logic to existing event handler
// Pattern: Already handles events for order book rebuild
//          Add graph update in SAME handler
//
// Flow:
//   1. Event received from Kafka
//   2. process_transactions(items) - existing (rebuild order books)
//   3. update_graph_from_events(items) - NEW (update graph)
//
// Why: Reuse existing event pipeline (ScBroadcaster → Kafka)
//      No need to create new consumer!

Change: Add one line: this.update_graph_from_events(items).await?;
```

**Deliverable:** Handler calls graph update logic

---

### **4.4. Implement Update Logic by Event Type**

#### Implementation Guide:

```rust
File: NEW - tapp/backend/src/utils/graph_updater.rs

// Purpose: Update graph based on event type
// Input: Graph cache + Events array
// Output: Updated graph (or no change)
//
// Update Rules (from GRAPH-UPDATE-STRATEGY.md):
//
//   PoolCreated:
//     → Add new edges to graph
//     → Always update
//
//   LiquidityAdded/Removed:
//     → Check IF spot price changed
//     → IF yes: Recalculate weight
//     → IF no: Skip (90% case!)
//
//   Swapped:
//     → Always update weight (reserves changed)
//     → Consider batching (high frequency)
//
// Helper functions needed:
//   - is_spot_price_changed(): Compare old/new reserve ratio
//   - add_edge_to_graph(): Add new edges for PoolCreated
//   - update_edge_weight(): Recalculate weight

Result: Graph stays synchronized with blockchain (10-15% update rate)
```

**Deliverable:** Graph update logic by event type

---

### **4.5. Testing**

#### Test Cases:

```bash
Test event types:
  ✅ PoolCreated → Graph adds edges
  ✅ AddLiquidity (balanced) → NO update
  ✅ AddLiquidity (imbalanced) → UPDATE  
  ✅ Swapped → UPDATE

Measure:
  - Graph update rate: Should be ~10-15%
  - Graph accuracy: Routes still optimal after updates
  - Performance: Update latency < 1ms per event

Monitor: Graph update frequency over time
```

**Deliverable:** Graph updates validated

---

## 📚 Related Documents

- [GRAPH-UPDATE-STRATEGY.md](../GRAPH-UPDATE-STRATEGY.md) - Event handling details
- [WEIGHT-APPROACHES-COMPARISON.md](../WEIGHT-APPROACHES-COMPARISON.md) - Update frequency

---

## ✅ Definition of Done

- [x] Events verified - EXISTS ✅ (see EVENT-LISTENER-TRACE.md)
- [ ] graph_cache added to OrderBookWorker
- [ ] Event filter updated (add CREATED_POOL_EVENT)
- [ ] Graph update handler integrated
- [ ] Update logic by event type implemented
- [ ] Spot price change detection working
- [ ] Update rate ~10-15% measured
- [ ] Tests pass
- [ ] Code reviewed

---

**Back to:** [Implementation Overview](../IMPLEMENTATION-TASKS-BREAKDOWN.md)

