# Task 1: Implement A* Algorithm (Fast Release)

> **Story Points:** 8 (Complex)  
> **Priority:** 🔴 CRITICAL  
> **Blocks:** Task 2 (need A* for est-swap3)  
> **Phase:** 2.1

---

## 🎯 Goal

Add feature flag + Implement A* search, remove chunking for 3+ hops (for fast testing in production)

---

## 📊 Strategy: Feature Flag First (Fast Release)

```
Why Feature Flag?
  ✅ Deploy to production FAST (flag OFF = safe)
  ✅ Turn flag ON to test A* with real traffic
  ✅ Easy rollback if issues (just toggle flag)
  ✅ Low-risk testing approach

Timeline:
  1. Deploy Task 1 to prod (flag OFF) → SAFE ✅
  2. Turn flag ON for 5% traffic → Monitor
  3. Gradual rollout (25%, 50%, 100%)
  4. Task 2 creates est-swap3 (removes flag, clean architecture)
```

---

## 📊 Why A* over DFS?

```
DFS (Phase 1):
  ❌ Random exploration
  ❌ No optimization for best route
  ❌ Slower for multi-hop

A* (Phase 2):
  ✅ Heuristic-guided search
  ✅ Finds best routes faster
  ✅ Better output quality
  ✅ Supports 3-5 hops efficiently
```

---

## 📋 Subtasks

### **1.1. Add Feature Flag**

**Dependencies:** None

#### Implementation:

```rust
File: tapp/backend/src/config.rs

pub struct Config {
    // ... existing fields ...
    pub feature_flag_sor_v2: bool,  // ← NEW
}

// Load from env
impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            // ...
            feature_flag_sor_v2: env::var("FEATURE_FLAG_SOR_V2")
                .unwrap_or_else(|_| "false".to_string())
                .parse()
                .unwrap_or(false),
        })
    }
}
```

**Deliverable:** Feature flag in config

---

### **1.2. Implement A* Search Function**

**Dependencies:** None  
**Reference:** `phase1-astar-mike.js` (in root folder)

#### Implementation Guide:

```rust
File: tapp/backend/src/utils/pool_route_utils.rs

// Purpose: Find best routes using A* algorithm
// Input:
//   - pools: All available pools
//   - token_in: Starting token address
//   - token_out: Target token address  
//   - max_hops: Maximum path length (3-5)
// Output: Top K routes (K=10), sorted by quality
//
fn find_all_routes_astar(
    pools: &[PlainPool],
    token_in: &str,
    token_out: &str,
    max_hops: usize,
) -> Vec<Vec<&PlainPool>> {
    // Step 1: Build graph with spot price weights
    //   - Create adjacency list from pools
    //   - Calculate weight = -log10(spotPrice) per edge
    
    // Step 2: Pre-compute heuristic (Reverse Dijkstra from target)
    //   - Run Dijkstra backwards from token_out
    //   - Store min cost to reach token_out from any token
    
    // Step 3: A* search for top K routes
    //   - Priority queue ordered by: cost + heuristic
    //   - Expand best paths first (heuristic guides search)
    //   - Stop when found K complete routes
    
    // Return top K routes
}

Example output:
  Route 0: [Pool(APT→USDC)]                    // 1 hop, direct
  Route 1: [Pool(APT→WETH), Pool(WETH→USDC)] // 2 hops
  Route 2: [Pool(APT→BTC), Pool(BTC→USDC)]   // 2 hops
```

**Deliverable:** Working A* algorithm

---

### **1.3. Use Feature Flag in Routing Logic**

**Dependencies:** 1.1, 1.2

#### Implementation Guide:

```rust
File: tapp/backend/src/worker/order_book_worker.rs
Location: process_active_requests() function

// Purpose: Switch between DFS (Phase 1) and A* (Phase 2) based on flag
// 
// Logic:
//   IF feature_flag_sor_v2 == true:
//     → Use find_all_routes_astar() (new A* implementation)
//   ELSE:
//     → Use find_all_routes_dfs() (existing Phase 1 implementation)
//
// Example:
//   flag OFF → DFS routes → Safe production behavior
//   flag ON  → A* routes  → Testing new algorithm
```

**Deliverable:** Feature flag controls A* vs DFS

---

### **1.4. Unuse Chunking for 3+ Hops**

**Dependencies:** 1.2

#### Implementation Guide:

```rust
File: tapp/backend/src/utils/pool_route_utils.rs
Location: ~Line 358-415 (near build_order_book_entries)

// Purpose: Generate order book entries WITHOUT chunking optimization
// Why: Chunking fails for 3+ hops due to route instability
// 
// Input:
//   - route_matrix: List of routes found by A*
//   - num_entries: Number of price points (1000)
//   - max_amount_in: Maximum swap amount
// Output: 
//   - entries: Array of {amounts, prices, route_idx, isExceed}
//
fn build_order_book_entries_v3(...) -> Vec<ObEntryWithRoute> {
    // Step 1: Generate amount points
    //   amounts = [step, 2*step, ..., 1000*step]
    
    // Step 2: For EACH amount (not chunked):
    //   2.1 Test amount with ALL routes
    //   2.2 Find route with BEST output
    //   2.3 Use that route for this entry
    
    // Step 3: Return entries array
}

Example:
  Amount 100:  Test Route0, Route1, Route2 → Route1 best → Use Route1
  Amount 200:  Test Route0, Route1, Route2 → Route2 best → Use Route2
  ...
  (Each amount independently chooses best route)
```

**Deliverable:** Skip chunking for A* routes (when feature flag ON or hops >= 3)

**Why Unuse Chunking:**
- See [CHUNKING-REMOVAL-EXPLANATION.md](../CHUNKING-REMOVAL-EXPLANATION.md)
- Chunking fails for 3+ hops due to route instability
- Better to test each amount with all routes

---

### **1.5. Testing Feature Flag & A* Algorithm**

**Dependencies:** 1.1, 1.2, 1.3, 1.4

#### Test Cases:

```bash
# Test with feature flag OFF (DFS - existing behavior)
# Test with feature flag ON (A* - new behavior)
# Compare output quality (A* should be better or equal)
# Verify: Top K routes make sense
# Benchmark: A* search time <50ms
```

**Deliverable:** Feature flag + A* validated

---

## 📚 Related Documents

- [CHUNKING-REMOVAL-EXPLANATION.md](../CHUNKING-REMOVAL-EXPLANATION.md) - Why remove chunking
- `phase1-astar-mike.js` - Reference implementation (in root folder)

---

## ✅ Definition of Done

- [ ] Feature flag added (FEATURE_FLAG_SOR_V2)
- [ ] A* search function implemented
- [ ] Feature flag controls A* vs DFS
- [ ] Chunking disabled for 3+ hops (when flag ON or hops >= 3)
- [ ] Tests pass (flag OFF = DFS, flag ON = A*)
- [ ] Can deploy to prod with flag OFF (safe)
- [ ] Code reviewed
- [ ] Documentation updated

---

**Back to:** [Implementation Overview](../IMPLEMENTATION-TASKS-BREAKDOWN.md)

