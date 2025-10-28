# Task 3.5: Heuristic Cache (OPTIONAL)

> **Story Points:** 3 (Easy)  
> **Priority:** 🟢 MEDIUM  
> **Depends:** Task 3 (in-memory graph)  
> **Phase:** 2.1

---

## 🎯 Goal

Pre-compute heuristics for common targets (5-10× A* speedup)

---

## 📋 Subtasks

### **3.5.1. Implement Reverse Dijkstra**

#### Implementation Guide:

```rust
File: tapp/backend/src/utils/graph_builder.rs

// Purpose: Pre-compute min costs from all tokens → target token
// Input: Graph, target token (e.g. "USDC")
// Output: Heuristic map (token → min_cost_to_target)
//
// Algorithm: Standard Dijkstra, but run BACKWARDS from target
//   - Start from target token
//   - Compute shortest path to all other tokens
//   - Result = h(token) for A* heuristic

Example:
  Target: USDC
  Result: {
    "APT"  → 1.5  // Min cost from APT to USDC
    "WETH" → 2.3  // Min cost from WETH to USDC
    "BTC"  → 3.1  // Min cost from BTC to USDC
  }
  
Used in A*: f(node) = g(node) + h(node)
  g = actual cost so far
  h = heuristic (pre-computed)
```

---

### **3.5.2. Cache for Common Targets**

#### Implementation Guide:

```rust
File: tapp/backend/src/worker/order_book_worker.rs

// Purpose: Pre-compute heuristics for common target tokens
// Why: Most swaps end at: USDC, WETH, APT, BTC
//      Pre-computing saves time per A* search
//
// Common targets: ["USDC", "WETH", "APT", "BTC"]
//
// On graph build/update:
//   For each common target:
//     - Run reverse Dijkstra
//     - Store in heuristic_cache
//
// On A* search:
//   IF target in cache → Use cached heuristic (fast!)
//   ELSE → Compute on-demand

Speedup: 5-10× faster A* search
```

---

### **3.5.3. Invalidate on Graph Changes**

#### Implementation Guide:

```rust
// Purpose: Clear heuristics when graph changes (Task 4)
// Why: Graph update → costs changed → heuristics stale
//
// Logic:
//   When graph updated:
//     - Clear ALL heuristics (simple)
//     OR
//     - Clear only affected tokens (complex, more efficient)
//
// Trade-off:
//   - Clear all: Simple, but re-compute on next search
//   - Selective: Complex, but keeps valid heuristics
//
// Recommendation: Clear all (simpler, still fast)
```

---

## 📚 Related Documents

---

## ✅ Definition of Done

- [ ] Reverse Dijkstra implemented
- [ ] Heuristic cache for common targets
- [ ] Invalidation on graph changes
- [ ] 5-10× A* speedup measured

---

**Back to:** [Implementation Overview](../IMPLEMENTATION-TASKS-BREAKDOWN.md)

