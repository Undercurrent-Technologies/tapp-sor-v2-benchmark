# Task 6: Route Splitting Algorithms

> **Story Points:** 13 (Very Complex)  
> **Priority:** 🔴 CRITICAL  
> **Depends:** Task 1 (A*), Task 2 (est-swap3)  
> **Phase:** 2.2

---

## 🎯 Goal

Implement Waterfill & Hillclimb algorithms for optimal order allocation

---

## 📋 Subtasks

### **6.1. Capacity Manager**

#### Implementation Guide:

```rust
File: NEW - tapp/backend/src/utils/capacity_manager.rs

// Purpose: Store pool states for slippage calculation
// Different from Graph: 
//   - Graph: Routing (which paths?) - Updates 10-15%
//   - Capacity: Execution (how much?) - Updates 100%
//
// CapacityManager stores:
//   - Current reserves (for slippage simulation)
//   - Pool type (AMM/CLMM/Stable - different formulas)
//   - Fee tier
//   - CLMM: Tick data, active liquidity
//   - Stable: Amp parameter
//
// Update frequency: EVERY event (100% rate)
// Why: Need accurate reserves for split optimization

Usage: Waterfill/Hillclimb use capacity to simulate swaps
```

**Deliverable:** Capacity manager  
**Note:** Separate from graph - updates on every event (100% rate)

---

### **6.2. Implement Waterfill Algorithm**

#### Implementation Guide:

```rust
File: NEW - tapp/backend/src/utils/route_splitter.rs

// Purpose: Split order across routes like "filling water"
// Input: Routes (from A*), total amount, capacity manager
// Output: Splits (route_idx + amount per route)
//
// Algorithm:
//   1. Divide total amount into small chunks (e.g. 100 chunks)
//   2. For each chunk:
//      - Test each route: What's marginal output?
//      - Allocate chunk to route with BEST marginal rate
//   3. Continue until all chunks allocated
//
// Analogy: Water fills lowest spots first
//   → Algorithm fills best routes first

Example:
  10,000 APT across 3 routes
  Chunk size: 100 APT
  Result: Route0=2000, Route1=3000, Route2=5000

Reference: phase2-waterfill.js (in root folder)
```

**Deliverable:** Waterfill algorithm

---

### **6.3. Implement Hillclimb Algorithm**

#### Implementation Guide:

```rust
// Purpose: Optimize splits by iterative improvement
// Input: Same as Waterfill
// Output: Splits (route_idx + amount)
//
// Algorithm:
//   1. Start with equal split across all routes
//   2. Try moving small amount from route A → route B
//   3. IF total output improves → Keep the move
//   4. Repeat for max_iterations or until converged
//
// Analogy: Climbing hill - keep moving if going up
//   → Algorithm keeps changes that improve output

Comparison with Waterfill:
  - Waterfill: Greedy (faster, good results)
  - Hillclimb: Iterative (slower, may find better optimum)
  
Decision: Benchmark both to choose

Reference: phase2-hillclimb.js (in root folder)
```

**Deliverable:** Hillclimb algorithm

---

### **6.4. Update Order Book Generator**

#### Implementation Guide:

```rust
File: tapp/backend/src/utils/pool_route_utils.rs

// Purpose: Generate order book WITH splits field
// Different from Phase 2.1: Each entry now has MULTIPLE routes
//
// For each entry amount:
//   1. Run Waterfill/Hillclimb to find optimal splits
//   2. Simulate swaps to get total output
//   3. Store: amounts, prices, splits[] (not single route_idx)
//
// Output format:
//   Entry {
//     amounts: [100, 4850],
//     prices: [...],
//     splits: [
//       { route_idx: 0, amount: 20 },
//       { route_idx: 1, amount: 30 },
//       { route_idx: 2, amount: 50 }
//     ]
//   }

Note: Task 7 updates response DTOs for splits field
```

**Deliverable:** Order book with splits

---

### **6.5. Benchmark & Select Algorithm**

#### Implementation Guide:

```bash
Test scenarios:
  - Small orders (<100 APT)
  - Medium orders (100-1000 APT)
  - Large orders (>1000 APT)

Measure:
  1. Output quality: Which gives better rates?
  2. Performance: Which is faster?
  3. Consistency: Which is more predictable?

Expected results:
  - Waterfill: Fast, good quality (likely winner)
  - Hillclimb: Slower, slightly better quality

Decision: Choose based on production requirements
```

**Deliverable:** Algorithm selection decision

---

## 📚 Related Documents

- `phase2-waterfill.js` - Reference (in root folder)
- `phase2-hillclimb.js` - Reference (in root folder)

---

## ✅ Definition of Done

- [ ] Capacity manager implemented
- [ ] Waterfill algorithm working
- [ ] Hillclimb algorithm working
- [ ] Order book generator with splits
- [ ] Algorithm comparison complete
- [ ] Production algorithm selected
- [ ] Tests pass
- [ ] Code reviewed

---

**Back to:** [Implementation Overview](../IMPLEMENTATION-TASKS-BREAKDOWN.md)

