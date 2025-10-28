# Task 3: In-Memory Graph

> **Story Points:** 8 (Complex)  
> **Priority:** 🟡 HIGH  
> **Depends:** Task 1 (A* algorithm), Task 2 (est-swap3 handler)  
> **Phase:** 2.1

---

## 🎯 Goal

Build and cache graph in memory for fast A* search

---

## 📋 Subtasks

### **3.1. Design Graph Data Structure**

**Dependencies:** None

#### Implementation Guide:

```rust
File: NEW - tapp/backend/src/models/graph.rs

// Purpose: Define graph structures for A* routing
//
// Graph: Adjacency list representation
//   - Key: token_addr (e.g. "APT")
//   - Value: List of edges from this token
//
// GraphEdge: One pool connection
//   - from, to: Token addresses
//   - pool_id: Pool address
//   - weight: -log10(spotPrice) for A* cost
//   - spot_price: Cached for quick updates (Task 4)
//
// Heuristic: Pre-computed costs for A* speedup (Task 3.5)
//   - Key: token_addr
//   - Value: Min cost to reach target token

Example:
  Graph {
    "APT" → [
      Edge { to: "USDC", pool_id: "0x123", weight: 2.5, spot_price: 50.0 },
      Edge { to: "WETH", pool_id: "0x456", weight: 3.1, spot_price: 0.008 }
    ],
    "WETH" → [
      Edge { to: "USDC", pool_id: "0x789", weight: 4.2, spot_price: 1800.0 }
    ]
  }
```

**Deliverable:** Graph type definitions

---

### **3.2. Implement Graph Builder**

**Dependencies:** Task 3.1

#### Implementation Guide:

```rust
File: NEW - tapp/backend/src/utils/graph_builder.rs

// Purpose: Convert pools list → graph structure
// Input: List of pools from DB
// Output: Graph (adjacency list)
//
fn build_graph_from_pools(pools: &[PlainPool]) -> Graph {
    // Step 1: Filter pools
    //   - Skip pools with < 2 tokens
    //   - Skip shallow pools (liquidity < threshold)
    //   - Threshold: sqrt(reserveA × reserveB) > 10,000
    
    // Step 2: For each valid pool:
    //   2.1 Calculate spot price
    //        - Approach 1: reserveTo / reserveFrom
    //        - Approach 3: (reserveTo / reserveFrom) × (1 - fee)
    //   2.2 Calculate weight = -log10(spotPrice)
    //   2.3 Create bidirectional edges (A→B and B→A)
    //   2.4 Add to adjacency list
    
    // Step 3: Return Graph
}

Example:
  Input: Pool(APT-USDC, reserves=[1000, 50000], fee=0.003)
  
  Processing:
    spotPrice = 50000/1000 × (1-0.003) = 49.85
    weight = -log10(49.85) = -1.698
  
  Output:
    APT → [Edge{to: USDC, weight: -1.698, ...}]
    USDC → [Edge{to: APT, weight: -3.301, ...}]  // Reverse direction
```

**Deliverable:** Graph builder function

---

### **3.3. Weight Calculation Decision**

**Dependencies:** None (decision needed)

#### Implementation Guide:

```rust
File: tapp/backend/src/utils/graph_builder.rs

// ⚠️ DECISION NEEDED: Choose Approach 1 or Approach 3
// See: WEIGHT-APPROACHES-COMPARISON.md for detailed comparison
//
// Both approaches have SAME update frequency (~10-15%)
// Both are viable for production!

Approach 1 (Pure spot price):
  weight = -log10(reserveTo / reserveFrom)
  
  Pros: Simpler
  Cons: Doesn't account for fees in routing
  Update rate: ~10%

Approach 3 (Spot + fee - RECOMMENDED):
  weight = -log10((reserveTo / reserveFrom) × (1 - fee))
  
  Pros: More realistic (includes fee impact)
  Cons: Slightly more complex
  Update rate: ~15% (adds FeeUpdated events)

Example comparison:
  Pool: 1000 APT ↔ 50,000 USDC, fee = 0.3%
  
  Approach 1: weight = -log10(50) = -1.699
  Approach 3: weight = -log10(50 × 0.997) = -1.696
  
  Difference: Minimal, but Approach 3 more accurate
```

**Deliverable:** Weight calculation function  
**Decision:** See [WEIGHT-APPROACHES-COMPARISON.md](../WEIGHT-APPROACHES-COMPARISON.md)

---

### **3.4. Add Graph Cache to OrderBookWorker**

**Dependencies:** Task 3.1, 3.2

#### Implementation Guide:

```rust
File: tapp/backend/src/worker/order_book_worker.rs

// Purpose: Store graph in OrderBookWorker for reuse
// Why: Building graph every request is expensive (~100ms)
//      Caching graph = reuse for all requests (~0.01ms access)
//
// Add to struct:
//   - graph_cache: Arc<RwLock<Option<Graph>>>
//        Stores current graph, shared across threads
//   - heuristic_cache: Arc<RwLock<HashMap<String, Heuristic>>>
//        Optional (Task 3.5), stores pre-computed heuristics

// Initialize in new():
//   graph_cache: Arc::new(RwLock::new(None))  // Empty at start
//   Build on first request or at startup

// Usage pattern:
//   1. Read graph from cache
//   2. If None → build from pools → cache it
//   3. If Some → use directly (fast!)
//   4. Update on events (Task 4)

Result: Fast routing - graph built once, reused many times
```

**Deliverable:** Worker with graph cache

---

### **3.5. Update A* to Use Cached Graph**

**Dependencies:** Task 3.4

#### Implementation Guide:

```rust
File: tapp/backend/src/utils/pool_route_utils.rs

// Purpose: Modify find_all_routes_astar() to accept cached graph
// 
// Add parameter: graph_cache: Option<&Graph>
//
// Logic:
//   IF graph_cache is Some:
//     → Use cached graph (fast! ~0.01ms)
//   ELSE:
//     → Build graph from pools (slow! ~100ms)
//
// Called from: process_active_requests_v3() (Task 2)
//   Pass graph from OrderBookWorker.graph_cache

Example flow:
  Request 1: No cache → Build graph → Cache it → Use for routing
  Request 2: Has cache → Use directly → Fast!
  Request 3: Has cache → Use directly → Fast!
  ...
  Event updates graph (Task 4) → Cache updated
  Request N: Use updated cache → Still fast!

Performance:
  Without cache: 100ms per request (rebuild graph each time)
  With cache:    0.01ms per request (just read from memory)
  Speedup:       10,000× faster! 🚀
```

**Deliverable:** A* uses cached graph

---

## 📚 Related Documents

- [WEIGHT-APPROACHES-COMPARISON.md](../WEIGHT-APPROACHES-COMPARISON.md) - Choose weight approach
- [GRAPH-UPDATE-STRATEGY.md](../GRAPH-UPDATE-STRATEGY.md) - How to update graph

---

## ✅ Definition of Done

- [ ] Graph data structures defined
- [ ] Graph builder implemented
- [ ] Weight calculation chosen (Approach 1 or 3)
- [ ] Graph added to OrderBookWorker
- [ ] A* uses cached graph
- [ ] Tests pass
- [ ] Code reviewed
- [ ] Documentation updated

---

**Back to:** [Implementation Overview](../IMPLEMENTATION-TASKS-BREAKDOWN.md)

