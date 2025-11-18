# SOR v2 POC V3 - Two-Phase Implementation

> **POC V3 Document** - Simplified two-phase approach  
> **Core Changes:** A* routing (Phase 1) + Separate route splitting API (Phase 2)  
> 
> **Status:** Planning 📋  
> **Target:** Q1 2026  
> **Owner:** Backend Team

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Phase 1: A* Routing + Orderbook Generation](#phase-1-astar-routing--orderbook-generation)
3. [Phase 2: Route Splitting API](#phase-2-route-splitting-api)
4. [Architecture Flow](#architecture-flow)
5. [Implementation Details](#implementation-details)
6. [Success Criteria](#success-criteria)
7. [References](#references)

---

## 🎯 Overview

### **Two-Phase Approach**

```
Phase 1: A* Routing + Orderbook (Backend Only)
  ✅ A* algorithm finds optimal routes (3+ hops)
  ✅ Generate orderbook with sampling + interpolation
  ✅ Feature flag to enable/disable
  ✅ NO frontend changes required

Phase 2: Route Splitting API (Separate Topic)
  ✅ New topic: est.split-route
  ✅ Waterfill algorithm for route splitting
  ✅ Input: routeMatrix (from Phase 1) + amountIn
  ✅ Output: Split routes with amounts
  ✅ Improvement: Separate API (not in orderbook entries)
    → Saves CPU & RAM
    → Real-time calculation
```

### **Key Improvements**

| Aspect | Old Approach | New Approach | Benefit |
|--------|-------------|--------------|---------|
| **Route Splitting** | In orderbook entries | Separate API | ✅ Less CPU/RAM, real-time |
| **Orderbook Generation** | Chunking (2 hops only) | Sampling + Interpolation | ✅ Works with 3+ hops |
| **Routing** | DFS (limited hops) | A* (3+ hops) | ✅ Better routes |

---

## 📅 Phase 1: A* Routing + Orderbook Generation

### **Goal**

Implement A* routing algorithm to find optimal routes (3+ hops) and generate orderbook using sampling + interpolation approach.

### **Features**

- ✅ A* algorithm for route discovery (3+ hops)
- ✅ Orderbook generation: Sampling + Interpolation (replaces chunking)
- ✅ Feature flag: `feature_flag_sor_v2` (config.toml)
- ✅ Backend changes only (no frontend changes)

### **Why Replace Chunking?**

```
Chunking Limitations:
  ❌ Only works well with 2 hops
  ❌ Poor accuracy with 3+ hops
  ❌ Performance degrades with more hops

Sampling + Interpolation:
  ✅ Works with any number of hops
  ✅ Better accuracy
  ✅ More flexible
```

### **Flow Diagram**

```
┌──────────┐
│ Frontend │ User selects token pair
└────┬─────┘
     │ 1. Subscribe: sc.est-swap2.{token0}-{token1}
     ▼
┌─────────────────┐
│ Display Engine  │
│ (est-swap2)     │
└────┬────────────┘
     │ 2. Send subscription request
     │    Kafka Topic: {env}.sc.est-swap2
     │    Kafka Key: get.request
     │    OR: Check cache first
     ▼
┌──────────┐
│  Kafka   │
└────┬─────┘
     │ 3. Backend consumes request
     ▼
┌──────────┐
│ Backend  │
│ liquid_  │
│ pool.rs  │
└────┬─────┘
     │ 4. A* Algorithm (if feature_flag_sor_v2=true)
     │    - Find routes (3+ hops)
     │    - Calculate weights
     │
     │ 5. Generate Orderbook
     │    - Sampling + Interpolation
     │    - Remove chunking logic
     │    - Create entries
     │
     │ 6. Return orderbook
     │    Kafka Topic: {env}.sc.est-swap2
     │    Kafka Key: get.response
     ▼
┌──────────┐
│  Kafka   │
└────┬─────┘
     │ 7. Display Engine receives response
     │    - Cache orderbook
     │    - Send snapshot to frontend
     ▼
┌─────────────────┐
│ Display Engine  │
│ GetScEstSwap2   │
└────┬────────────┘
     │ 8. Send snapshot via WebSocket
     ▼
┌──────────┐
│ Frontend │ Receives initial orderbook
└──────────┘

┌─────────────────────────────────────────┐
│ Real-time Updates (Orderbook Worker)    │
└─────────────────────────────────────────┘

Blockchain Event (swap/add/remove liquidity)
    │
    ▼
┌──────────┐
│ Backend  │
│ Orderbook│
│ Worker   │
└────┬─────┘
     │ 9. Consume: sc.events.completed
     │ 10. Rebuild orderbook
     │     - A* find routes (if feature_flag_sor_v2=true)
     │     - Generate with sampling
     │
     │ 11. Publish: {env}.sc.est-swap2.notify
     │     Kafka Key: notification
     ▼
┌──────────┐
│  Kafka   │
└────┬─────┘
     │ 12. Display Engine consumes
     ▼
┌─────────────────┐
│ Display Engine  │
│ OnEstSwap2      │
│ Notification    │
└────┬────────────┘
     │ 13. Update cache
     │ 14. Broadcast via WebSocket
     ▼
┌──────────┐
│ Frontend │ Receives real-time update
└──────────┘
```

### **Implementation Tasks**

#### **Task 1.1: A* Algorithm Implementation**

```rust
// File: tapp/backend/src/utils/pool_route_utils.rs

// Feature flag check
let use_astar = config.smart_router.feature_flag_sor_v2;

if use_astar || max_hops >= 3 {
    // Use A* algorithm
    let routes = astar_search(
        &graph,
        from_token,
        to_token,
        max_hops,
        top_k,
    )?;
} else {
    // Fallback to DFS (existing)
    let routes = dfs_search(...)?;
}
```

**Deliverables:**
- [ ] A* search function
- [ ] Graph structure for A* (in-memory)
- [ ] Weight calculation (spot price based)
- [ ] Feature flag integration

#### **Task 1.2: Orderbook Generation (Sampling + Interpolation)**

```rust
// File: tapp/backend/src/utils/pool_route_utils.rs

fn build_order_book_with_sampling(
    route_matrix: &[Vec<RouteHop>],
    pool_ticks: &DashMap<String, Vec<Tick>>,
    num_samples: i64,
) -> anyhow::Result<Vec<ObEntryWithRoute>> {
    // 1. Generate sample amounts (evenly distributed)
    let sample_amounts = generate_sample_amounts(num_samples);
    
    // 2. For each sample amount:
    for amount in sample_amounts {
        // Simulate all routes
        let results = simulate_all_routes(route_matrix, amount)?;
        
        // Find best route
        let best_route = select_best_route(results)?;
        
        // Create entry
        entries.push(ObEntryWithRoute {
            amounts: vec![amount, best_route.output],
            route_idx: best_route.idx,
            is_exceed: best_route.is_exceed,
        });
    }
    
    // 3. Frontend will interpolate between entries
    Ok(entries)
}
```

**Deliverables:**
- [ ] Remove chunking logic
- [ ] Implement sampling algorithm
- [ ] Generate evenly distributed sample amounts
- [ ] Test with 3+ hops routes

#### **Task 1.3: Feature Flag**

```toml
# File: tapp/backend/config.toml

[smart_router]
feature_flag_sor_v2 = true
max_hops = 3
top_k = 5
order_book_sample_rate = 20
```

**Deliverables:**
- [ ] Config field: `feature_flag_sor_v2` in config.toml
- [ ] Config struct already exists (SmartRouter struct)
- [ ] Integration in route finding logic (already done in `find_route_matrix`)

---

## 📅 Phase 2: Route Splitting API

### **Goal**

Create separate API endpoint for route splitting to avoid CPU/RAM overhead in orderbook generation.

### **Features**

- ✅ New Kafka topic: `est.split-route`
- ✅ Waterfill algorithm for optimal route splitting
- ✅ Input: `routeMatrix` (from Phase 1) + `amountIn`
- ✅ Output: Split routes with allocated amounts
- ✅ Real-time calculation (on-demand)

### **Why Separate API?**

```
Problem with Route Splitting in Orderbook:
  ❌ CPU intensive: Calculate splits for every entry
  ❌ RAM intensive: Store splits in memory
  ❌ Not real-time: Pre-calculated splits may be stale
  ❌ Wasteful: Most entries never used

Solution: Separate API
  ✅ On-demand calculation (only when needed)
  ✅ Real-time: Always uses latest pool state
  ✅ Efficient: No pre-calculation overhead
  ✅ Flexible: Can adjust algorithm without affecting orderbook
```

### **Flow Diagram**

```
┌──────────┐
│ Frontend │ User enters amount (e.g., 10,000 APT)
└────┬─────┘
     │ 1. Call route splitting API
     │    POST /api/v2/route-split
     │    {
     │      "routeMatrix": [...],
     │      "amountIn": "10000"
     │    }
     ▼
┌─────────────────┐
│ Display Engine  │
│ est-route-       │
│ splitting        │
└────┬─────────────┘
     │ 2. Forward to backend
     │    Kafka: est.split-route.request
     ▼
┌──────────┐
│  Kafka   │
└────┬─────┘
     │ 3. Consume request
     ▼
┌──────────┐
│ Backend  │
│ liquid_  │
│ pool.rs  │
└────┬─────┘
     │ 4. Waterfill Algorithm
     │    - Input: routeMatrix + amountIn
     │    - Calculate optimal splits
     │    - Return split allocations
     │
     │ 5. Publish response
     │    Kafka: est.split-route.response
     ▼
┌──────────┐
│  Kafka   │
└────┬─────┘
     │ 6. Display Engine consumes
     ▼
┌─────────────────┐
│ Display Engine  │
│ Return to       │
│ Frontend        │
└────┬────────────┘
     │ 7. Response
     │    {
     │      "splits": [
     │        { "routeIdx": 0, "amount": "2000" },
     │        { "routeIdx": 1, "amount": "3000" },
     │        { "routeIdx": 2, "amount": "5000" }
     │      ],
     │      "totalOutput": "463000"
     │    }
     ▼
┌──────────┐
│ Frontend │ Display split breakdown
└──────────┘
```

### **Implementation Tasks**

#### **Task 2.1: Backend Route Split Handler**

```rust
// File: tapp/backend/src/services/liquid_pool.rs

pub async fn est_route_split(
    &self,
    req: EstRouteSplit,
) -> anyhow::Result<Option<ObEntryWithSplits>> {
    let EstRouteSplit {
        route_matrix,
        amount_in,
        cover_percentage,
    } = req;

    // 1. Get pool states (capacity)
    let pool_ticks = self.fetch_pool_ticks(&route_matrix).await?;
    
    // 2. Create capacity manager
    let capacity_manager = CapacityManager::from_route_matrix(
        &route_matrix,
        &pool_ticks,
    );
    
    // 3. Run Waterfill algorithm
    let splits = optimize_splits_waterfill(
        &route_matrix,
        &amount_in,
        &capacity_manager,
        &cover_percentage,
    )?;
    
    // 4. Calculate total output
    let total_output = calculate_total_output(&splits)?;
    
    Ok(EstRouteSplitResponse {
        splits,
        total_output,
        improvement: calculate_improvement(&splits, &route_matrix)?,
    })
}
```

**Deliverables:**
- [ ] Request/Response DTOs
- [ ] Route split handler function
- [ ] Waterfill algorithm integration
- [ ] Error handling

#### **Task 2.2: Kafka Topic Setup**

```rust
// File: tapp/backend/src/config/kafka_topics.rs

pub const EST_ROUTE_SPLIT_REQUEST: &str = "{env}.sc.est.split-route.request";
pub const EST_ROUTE_SPLIT_RESPONSE: &str = "{env}.sc.est.split-route.response";
```

**Deliverables:**
- [ ] Kafka topic definitions
- [ ] Producer/Consumer setup
- [ ] Message serialization

#### **Task 2.3: Display Engine Endpoint**

```go
// File: tapp-display-engine/internal/sc/sc.go

func (p *sc) GetRouteSplit(
    ctx context.Context,
    req RouteSplitRequest,
) (any, *ws.ErrorMessage) {
    // 1. Send request to backend via Kafka
    prod, err := producer.NewProducer(
        EST_ROUTE_SPLIT_REQUEST.Get(app.Config.KafkaEnv),
    )
    
    // 2. Wait for response
    response := waitForResponse(correlationID)
    
    // 3. Return to frontend
    return response, nil
}
```

**Deliverables:**
- [ ] REST/WebSocket endpoint
- [ ] Kafka producer/consumer
- [ ] Correlation ID handling
- [ ] Response caching (optional)

#### **Task 2.4: Frontend Integration**

```typescript
// File: tapp/frontend/src/components/swap/hooks/use-route-split.ts

export const useRouteSplit = () => {
  const fetchRouteSplit = async (
    routeMatrix: RouteMatrix,
    amountIn: string,
  ): Promise<RouteSplitResponse> => {
    const response = await fetch('/api/v2/route-split', {
      method: 'POST',
      body: JSON.stringify({
        routeMatrix,
        amountIn,
      }),
    });
    
    return response.json();
  };
  
  return { fetchRouteSplit };
};
```

**Deliverables:**
- [ ] API client function
- [ ] UI component for split display
- [ ] Integration with swap flow

---

## 🏗️ Architecture Flow

### **Complete Flow: Phase 1 + Phase 2**

```
┌─────────────────────────────────────────────────────────────┐
│              PHASE 1: Orderbook Flow (Quote/Swap)           │
└─────────────────────────────────────────────────────────────┘

User selects token pair OR enters amount for swap
    │
    ▼
Frontend → Display Engine (est-swap2 subscription)
    │
    ▼
Display Engine → Check cache OR → Kafka Topic: {env}.sc.est-swap2 (key: get.request)
    │
    ▼
Backend (liquid_pool.rs)
    │
    ├─► A* Algorithm (if feature_flag_sor_v2=true)
    │   └─► Find routes (3+ hops)
    │
    └─► Generate Orderbook
        ├─► Sampling + Interpolation
        └─► Remove chunking
    │
    ▼
Backend → Kafka Topic: {env}.sc.est-swap2 (key: get.response)
    │
    ▼
Display Engine → Cache + Send snapshot to Frontend
    │
    ▼
Frontend → Receive orderbook (routeMatrix + entries)


┌─────────────────────────────────────────────────────────────┐
│        PHASE 1: Real-time Updates (Orderbook Worker)         │
└─────────────────────────────────────────────────────────────┘

Blockchain Event (swap/add/remove liquidity)
    │
    ▼
Backend Orderbook Worker
    │
    ├─► Consume: sc.events.completed
    │
    ├─► Rebuild orderbook
    │   ├─► A* find routes (if feature_flag_sor_v2=true)
    │   └─► Generate with sampling
    │
    └─► Publish: {env}.sc.est-swap2.notify (key: notification)
    │
    ▼
Display Engine → OnEstSwap2Notification
    │
    ├─► Update cache
    └─► Broadcast via WebSocket
    │
    ▼
Frontend → Receive real-time update


┌─────────────────────────────────────────────────────────────┐
│              PHASE 2: Route Splitting Flow                    │
└─────────────────────────────────────────────────────────────┘

User enters specific amount (e.g., 10,000 APT)
    │
    ▼
Frontend → Display Engine (est-route-splitting API)
    │    POST /api/v2/route-split
    │    {
    │      "routeMatrix": [...],  // From Phase 1 orderbook
    │      "amountIn": "10000"
    │    }
    │
    ▼
Display Engine → Kafka (est.split-route.request)
    │
    ▼
Backend (liquid_pool.rs)
    │
    └─► Waterfill Algorithm
        ├─► Input: routeMatrix + amountIn
        ├─► Calculate optimal splits
        └─► Return split allocations
    │
    ▼
Backend → Kafka (est.split-route.response)
    │
    ▼
Display Engine → Return to Frontend
    │
    ▼
Frontend → Display split breakdown
    │    {
    │      "splits": [
    │        { "routeIdx": 0, "amount": "2000" },
    │        { "routeIdx": 1, "amount": "3000" },
    │        { "routeIdx": 2, "amount": "5000" }
    │      ]
    │    }
```

### **Key Components**

| Component | Purpose | Phase | Status |
|-----------|---------|-------|--------|
| **A* Algorithm** | Route discovery (3+ hops) | Phase 1 | ✅ Done |
| **Orderbook Generator** | Sampling + Interpolation | Phase 1 | ✅ Done |
| **Feature Flag** | Enable/disable A* | Phase 1 | ✅ Done |
| **Route Split API** | Waterfill splitting | Phase 2 | 🚧 In Progress |
| **Display Engine Endpoint** | Route split handler | Phase 2 | 🚧 In Progress |
| **Frontend Integration** | Split display UI | Phase 2 | 🚧 In Progress |

---

## 📝 Implementation Details

### **Phase 1: Orderbook Generation Changes**

#### **Before (Chunking - 2 hops only):**

```rust
// Old approach: Chunking
fn build_order_book_with_chunking(
    route_matrix: &[Vec<RouteHop>],
    num_entries: i64,
) -> Vec<ObEntryWithRoute> {
    // Split into chunks
    // Test first amount in chunk
    // Use same route for entire chunk
    // ❌ Only works with 2 hops
}
```

#### **After (Sampling + Interpolation - 3+ hops):**

```rust
// New approach: Sampling + Interpolation
fn build_order_book_with_sampling(
    route_matrix: &[Vec<RouteHop>],
    num_samples: i64,
) -> Vec<ObEntryWithRoute> {
    // Generate evenly distributed samples
    // For each sample: simulate all routes
    // Select best route per sample
    // ✅ Works with any number of hops
    // ✅ Frontend interpolates between samples
}
```

### **Phase 2: Route Splitting API**

#### **Request Format:**

```json
{
  "routeMatrix": [
    [
      { "poolId": "pool1", "fromIdx": 0, "toIdx": 1 }
    ],
    [
      { "poolId": "pool2", "fromIdx": 0, "toIdx": 1 },
      { "poolId": "pool3", "fromIdx": 0, "toIdx": 1 }
    ]
  ],
  "amountIn": "10000",
  "coverPercentage": 0.4
}
```

#### **Response Format:**

```json
{
  "splits": [
    {
      "routeIdx": 0,
      "amountIn": "2000",
      "amountOut": "79000",
      "isExceed": false
    },
    {
      "routeIdx": 1,
      "amountIn": "3000",
      "amountOut": "120000",
      "isExceed": false
    },
    {
      "routeIdx": 2,
      "amountIn": "5000",
      "amountOut": "200000",
      "isExceed": false
    }
  ],
  "totalOutput": "399000",
  "improvement": "15.2%",
  "algorithm": "waterfill"
}
```

---

## ✅ Success Criteria

### **Phase 1: A* Routing + Orderbook**

```
Performance:
  ✅ A* search: <50ms (top 5 routes, 3-5 hops)
  ✅ Orderbook generation: <200ms (100 samples)
  ✅ Feature flag: Can enable/disable without restart
  
Output Quality:
  ✅ Routes: 3-5 hops (vs 2 hops before)
  ✅ Orderbook: Accurate with sampling + interpolation
  ✅ Improvement: +20-40% vs Phase 1 baseline
  
Frontend Impact:
  ✅ NO CHANGES required
  ✅ Same response format (routeMatrix + entries)
```

### **Phase 2: Route Splitting API**

```
Performance:
  ✅ Route split calculation: <100ms
  ✅ API response time: <200ms (end-to-end)
  ✅ Real-time: Always uses latest pool state
  
Output Quality:
  ✅ Optimal splits via Waterfill
  ✅ Improvement: +50-180% for large orders
  ✅ Price impact: <10% (vs 67% single route)
  
Architecture:
  ✅ Separate API (not in orderbook)
  ✅ CPU/RAM efficient (on-demand only)
  ✅ Scalable (can handle concurrent requests)
```

---

## 📚 References

### **Core Documents:**

1. **[Implementation Plan](./poc-v3/implementation-plan.md)** ⭐
   - Current implementation status
   - Task breakdown

### **Working Code Reference:**

- `tapp-sor-v2-benchmark/phase1-astar-mike.js` - A* implementation
- `tapp-sor-v2-benchmark/phase2-waterfill.js` - Waterfill splitting

---

**Document Version:** 3.0  
**Last Updated:** January 2026  
**Status:** 
- Phase 1: ✅ Done
- Phase 2: 🚧 In Progress

