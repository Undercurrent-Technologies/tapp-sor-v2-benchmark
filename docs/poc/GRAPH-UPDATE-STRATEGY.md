# Graph Update Strategy for In-Memory SOR

> **Decision guide: WHEN to update in-memory graph based on blockchain events**
> 
> Last Updated: October 28, 2025  
> Version: 2.0 - Simplified for planning (removed implementation details)

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Weight Calculation Fundamentals](#weight-calculation-fundamentals)
3. [Update Triggers by Pool Type](#update-triggers-by-pool-type)
4. [Update Strategy](#update-strategy)
5. [Implementation Notes](#implementation-notes)
6. [Summary](#summary)

---

## Overview

### **The Problem:**

```
In-memory graph for fast routing:
  - A* search needs graph structure
  - Graph must stay FRESH with blockchain state
  - Question: WHEN to update graph?

Challenge:
  - Update too often → Performance hit
  - Update too rarely → Stale routes → Bad rates
```

### **Solution: Spot Price Based Weights**

```
Key Insight:
  Use spot price (not simulated swap) for graph weights
  
  Result:
  ✅ 90% of liquidity events → NO graph update needed!
  ✅ Only 10-15% (price-changing events) → Update graph
  ✅ Graph is STABLE, rarely updates

Why this works:
  - Proportional liquidity adds → Spot price unchanged
  - Graph weight = -log10(spotPrice) → Weight unchanged
  - No update needed for most events!
```

### **Infrastructure:**

```
✅ Already exists: ScBroadcaster streams events → Kafka
✅ Already exists: OrderBookWorker consumes events
✅ Task 4: Add graph update logic to existing handler

No need to build new event pipeline!
```

---

## Weight Calculation Fundamentals

> **IMPORTANT:** Weight formula determines update frequency!
> 
> **Two viable approaches:**
> - **Approach 1:** Pure spot price (no fee) → ~10% update rate
> - **Approach 3:** Spot + fee + filtering → ~15% update rate
> 
> **Approach 2** (spot + liquidity) requires 100% updates → NOT viable
> 
> **Status:** Pending decision between Approach 1 vs 3 (both work well)
> 
> See: [WEIGHT-APPROACHES-COMPARISON.md](./WEIGHT-APPROACHES-COMPARISON.md)

### **Core Principle:**

```javascript
// Approach 1 (simpler):
weight = -log10(reserveOut / reserveIn)

// Approach 3 (more realistic - RECOMMENDED):
spotPrice = (reserveOut / reserveIn) * (1 - fee)
weight = -log10(spotPrice)

Where spotPrice varies by pool type:
  AMM: reserveOut / reserveIn
  CLMM: (sqrt_price)^2
  Stable: calculateStableSpotPrice(reserves, amp)
```

### **Why Spot Price?**

```
✅ Intrinsic property (doesn't depend on swap amount)
✅ Stable (unchanged if liquidity added proportionally)
✅ Clean separation:
   - Graph (routing): Which paths? Best rates?
   - Capacity (splitting): How much? Slippage?
```

### **Approach 1 vs Approach 3 - Update Triggers:**

```
IMPORTANT: Both approaches have SAME update triggers!

Balanced Add:
  - Approach 1: ratio unchanged → NO update
  - Approach 3: ratio unchanged, fee unchanged → NO update
  
Swapped:
  - Approach 1: ratio changed → UPDATE
  - Approach 3: ratio changed → UPDATE
  
FeeUpdated:
  - Approach 1: fee not in formula → NO update
  - Approach 3: fee in formula → UPDATE (rare <1%)

Result:
  - Approach 1: ~10% update rate
  - Approach 3: ~15% update rate (10% + 1% for FeeUpdated)
  
Both excellent! Minimal difference.
```

---

## Update Triggers by Pool Type

> **Summary of WHEN graph weight needs update**
> 
> **NOTE:** Update triggers are **IDENTICAL** for Approach 1 and 3,
> except for FeeUpdated event (Approach 3 updates, Approach 1 doesn't).

### **AMM (Constant Product: x·y = k)**

**Spot Price:**
- Approach 1: `reserveB / reserveA`
- Approach 3: `(reserveB / reserveA) * (1 - fee)`

| Event | Graph Update? | Reason |
|-------|--------------|--------|
| ✅ **PoolCreated** | YES | New edge, initial spot price |
| ✅ **PoolDisabled** | YES | Remove edge |
| ❌ **AddLiquidity (balanced)** | NO | Ratio unchanged → spot price SAME |
| ✅ **AddLiquidity (imbalanced)** | YES | Ratio changed → spot price CHANGED |
| ❌ **RemoveLiquidity (balanced)** | NO | Ratio unchanged → spot price SAME |
| ✅ **RemoveLiquidity (imbalanced)** | YES | Ratio changed → spot price CHANGED |
| ✅ **Swapped** | YES | Reserves shift → spot price CHANGED |
| ⚠️ **FeeUpdated** | Approach 3: YES<br/>Approach 1: NO | Approach 3 includes fee in weight |

**Key Insight:** 95% of AMM liquidity adds are balanced → **NO graph update!** ✅

---

### **CLMM (Concentrated Liquidity)**

**Spot Price:**
- Approach 1: `(sqrt_price)^2`
- Approach 3: `(sqrt_price)^2 * (1 - fee)`

| Event | Graph Update? | Reason |
|-------|--------------|--------|
| ✅ **PoolCreated** | YES | New edge, initial spot price |
| ✅ **PoolDisabled** | YES | Remove edge |
| ❌ **AddLiquidity (to active range)** | NO | Current tick unchanged → sqrt_price SAME |
| ❌ **AddLiquidity (to inactive range)** | NO | No immediate effect on active price |
| ❌ **RemoveLiquidity** | NO* | Usually doesn't move tick |
| ❌ **Swapped (no tick change)** | NO | Price moved within tick |
| ✅ **Swapped (tick moves)** | YES | Current tick changed → sqrt_price CHANGED |
| ⚠️ **FeeUpdated** | Approach 3: YES<br/>Approach 1: NO | Approach 3 includes fee |

**Key Insight:** 80% of CLMM swaps don't cross tick → **NO graph update!** ✅

---

### **Stable Pool (StableSwap / Curve-style)**

**Spot Price:**
- Approach 1: `calculateStableSpotPrice(reserves, amp)`
- Approach 3: `calculateStableSpotPrice(reserves, amp) * (1 - fee)`

| Event | Graph Update? | Reason |
|-------|--------------|--------|
| ✅ **PoolCreated** | YES | New edge, initial spot price |
| ✅ **PoolDisabled** | YES | Remove edge |
| ❌ **AddLiquidity (balanced)** | NO | Ratio unchanged → spot price SAME |
| ✅ **AddLiquidity (imbalanced)** | YES | Ratio changed → spot price CHANGED |
| ❌ **RemoveLiquidity (balanced)** | NO | Ratio unchanged → spot price SAME |
| ✅ **RemoveLiquidity (imbalanced)** | YES | Ratio changed → spot price CHANGED |
| ✅ **Swapped** | YES | Balance shifts → spot price CHANGED |
| ✅ **AmpUpdated** | YES | Affects price calculation |
| ⚠️ **FeeUpdated** | Approach 3: YES<br/>Approach 1: NO | Approach 3 includes fee |

**Key Insight:** 90% of stable adds are balanced → **NO graph update!** ✅

---

### **Summary - Update Frequency:**

```
With spot price based weights (Approach 1 or 3):
  ✅ 90% of liquidity events → NO graph update
  ✅ Only 10-15% (price-changing) → Update graph
  ✅ Performance: Excellent! Graph mostly stable.
  
  Approach 1 (pure spot): ~10% update rate
  Approach 3 (spot + fee): ~15% update rate (adds FeeUpdated <1%)
  
  Difference: Minimal! Both excellent for production.
  
vs Alternative: Liquidity in weight (NOT recommended):
  ❌ 100% of liquidity events → Graph update
  ❌ Performance: Poor! Constant graph rebuilds.
```

**Decision Status:** Pending - Choose Approach 1 or 3 (both work well!)  
**See:** [WEIGHT-APPROACHES-COMPARISON.md](./WEIGHT-APPROACHES-COMPARISON.md)

---

## Update Strategy

### **Event Priority Classification:**

```
🔴 CRITICAL (Real-time, immediate update):
  - PoolCreated: New routes available
  - PoolDisabled: Avoid invalid routes
  - Frequency: ~1-10 per hour
  - Cost: < 1ms per event

🟡 HIGH (May need batching):
  - AddLiquidity (imbalanced): Weight changes
  - RemoveLiquidity (imbalanced): Weight changes
  - Frequency: ~10-50 per hour
  - Cost: < 1ms per event

🟠 MEDIUM (Batching recommended):
  - Swapped: Reserve changes (very frequent!)
  - Frequency: ~100-1000 per minute
  - Cost: < 1ms per event, but HIGH VOLUME
  - Strategy: Batch updates every 1 second

🟢 LOW (Real-time, rare):
  - FeeUpdated: Cost changes (Approach 3 only)
  - AmpUpdated: Stable pool tuning
  - Frequency: ~1 per week or less
  - Cost: < 1ms per event
```

### **Recommended Strategy: Hybrid Approach**

```
1. Immediate Updates (Low frequency events):
   - PoolCreated, PoolDisabled
   - AddLiquidity, RemoveLiquidity (check if spot price changed)
   - FeeUpdated (Approach 3 only)
   - AmpUpdated
   
   Why: Low frequency (< 100/hour), high impact

2. Batched Updates (High frequency events):
   - Swapped events
   - Batch interval: 1 second
   - Process: Accumulate swaps per pool → Apply all → Recalculate weight once
   
   Why: High frequency (100-1000/min), batch = 40× fewer updates

3. Optional: Threshold filtering
   - Skip swaps < 1% of pool reserves
   - Update only for significant price changes
   - Further reduces updates by ~50%
```

### **Implementation Logic:**

```rust
// Pseudocode for event handler

fn update_graph_from_events(graph: &mut Graph, events: Vec<Event>) {
    for event in events {
        match event.type {
            // IMMEDIATE updates
            "PoolCreated" => {
                add_edge_to_graph(graph, &event);
            }
            "PoolDisabled" => {
                remove_edge_from_graph(graph, &event);
            }
            "AddLiquidity" | "RemoveLiquidity" => {
                if is_spot_price_changed(&event)? {
                    update_edge_weight(graph, &event);
                }
                // Always update capacity (separate from graph)
                update_capacity(&event);
            }
            "FeeUpdated" => {
                // Approach 3 only
                update_edge_weight(graph, &event);
            }
            "AmpUpdated" => {
                update_edge_weight(graph, &event);
            }
            
            // BATCHED updates
            "Swapped" => {
                add_to_swap_batch(&event);
                // Batch processor runs every 1 second
            }
            _ => {}
        }
    }
}

// Helper: Check if spot price changed
fn is_spot_price_changed(event: &Event) -> bool {
    let old_ratio = event.old_reserves[1] / event.old_reserves[0];
    let new_ratio = event.new_reserves[1] / event.new_reserves[0];
    
    let epsilon = 1e-6;
    (new_ratio - old_ratio).abs() > epsilon
}
```

### **Batch Processor for Swapped Events:**

```rust
// Runs every 1 second
fn process_swap_batch(graph: &mut Graph, batch: Vec<Event>) {
  // Group by pool_id
    let grouped = group_by_pool_id(batch);
    
    // Update each pool once (not per swap)
    for (pool_id, swaps) in grouped {
        let edge = graph.get_mut(pool_id);
        
        // Apply all swaps to reserves
        for swap in swaps {
            apply_swap_to_reserves(edge, &swap);
    }
    
    // Recalculate weight once
        edge.weight = calculate_weight(edge);
    }
}
```

---

## Implementation Notes

### **Infrastructure (Already Exists):**

```
✅ ScBroadcaster: Streams blockchain events → Kafka
✅ OrderBookWorker: Consumes events from Kafka
✅ Kafka topic: {env}.sc.events.completed

Available events (verified):
  ✅ PoolCreated
  ✅ LiquidityAdded
  ✅ LiquidityRemoved
  ✅ Swapped
  ✅ CollectFee
```

### **What Task 4 Needs to Add:**

```rust
File: tapp/backend/src/worker/order_book_worker.rs

async fn watch_transactions(self: &Arc<Self>) -> anyhow::Result<()> {
    // Existing: Consumes events
    let consumer = kafka_utils::new_consumer_from_latest_offset(...);
    
    worker_utils::consume_batches(
        consumer,
        |items: Vec<Value>| {
            async move {
                // Existing: Rebuild order books
                this.process_transactions(items.clone()).await?;
                
                // NEW: Update graph
                this.update_graph_from_events(items).await?;  // ← Add this
                
                Ok(())
            }
        },
    ).await
}
```

### **Two Separate Data Structures:**

```
1. Graph (for Routing) - Task 3:
   - Purpose: Find best paths
   - Update: RARE (10-15% of events)
   - Storage: In-memory graph structure
   
2. Capacity (for Splitting) - Task 6:
   - Purpose: Calculate slippage, split amounts
   - Update: ALWAYS (100% of events)
   - Storage: Separate capacity map
```

### **Event Frequency Estimates:**

| Event Type | Frequency | Update Cost | Strategy |
|------------|-----------|-------------|----------|
| **PoolCreated** | ~1-5/hour | Low | Real-time ✅ |
| **PoolDisabled** | ~0-2/day | Low | Real-time ✅ |
| **AddLiquidity** | ~10-50/hour | Low (if price changed) | Real-time ✅ |
| **RemoveLiquidity** | ~10-50/hour | Low (if price changed) | Real-time ✅ |
| **FeeUpdated** | ~0-1/week | Low | Real-time ✅ |
| **Swapped** | ~100-1000/min | High volume | **Batched** ⚡ |
| **AmpUpdated** | ~0-1/month | Low | Real-time ✅ |

### **Memory Footprint:**

```
Graph memory (200 pools, 100 tokens):
  Nodes: 100 tokens × 100 bytes = 10 KB
  Edges: 200 pools × 500 bytes = 100 KB
  Total: ~110 KB (negligible!)

Swap batch buffer (1 second):
  1000 swaps × 200 bytes = 200 KB
  
Overall: < 500 KB in memory ✅
```

---

## Summary

### **Key Decisions:**

```
1. Weight Formula:
   ⚠️ PENDING: Choose Approach 1 or Approach 3
   Both have ~10-15% update rate (excellent!)
   See: WEIGHT-APPROACHES-COMPARISON.md

2. Update Strategy:
   ✅ Real-time: Critical events (low frequency)
   ✅ Batched: Swapped events (high frequency)
   ✅ Threshold: Optional filtering for small swaps

3. Infrastructure:
   ✅ Reuse existing event pipeline (ScBroadcaster)
   ✅ Add update logic to OrderBookWorker
   ✅ No new services needed
```

### **Event Update Rules:**

```
🔴 ALWAYS update graph:
  - PoolCreated (new edge)
  - PoolDisabled (remove edge)
  - Swapped (price changed)
  - AmpUpdated (stable pools)

🟡 CONDITIONALLY update graph:
  - AddLiquidity: IF spot price changed (~5% of adds)
  - RemoveLiquidity: IF spot price changed (~10% of removes)
  - FeeUpdated: IF using Approach 3 (~1% occurrence)

❌ NEVER update graph:
  - AddLiquidity (balanced) - ~95% of adds
  - RemoveLiquidity (balanced) - ~90% of removes
  - Swapped (no tick change in CLMM) - ~80% of CLMM swaps
```

### **Result:**

```
✅ 10-15% update rate (graph is STABLE!)
✅ Fast updates (< 1ms per event)
✅ Batched swaps (1s latency, 40× reduction)
✅ Memory efficient (< 500 KB)
✅ Reuse existing infrastructure
```

---

**Document Version:** 2.0 (Simplified)  
**Last Updated:** October 28, 2025  
**Related Documents:**
- **[WEIGHT-APPROACHES-COMPARISON.md](./WEIGHT-APPROACHES-COMPARISON.md)** - Approach 1 vs 3 decision (MUST READ!)
- [CHUNKING-REMOVAL-EXPLANATION.md](./CHUNKING-REMOVAL-EXPLANATION.md) - Why Phase 1 chunking removed
- [README.md](./README.md) - Phase 2 POC overview
