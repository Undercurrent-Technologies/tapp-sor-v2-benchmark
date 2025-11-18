# SOR v2 Implementation Plan (Latest)

- [x] **Task 1 – A* Routing Engine** ✅ Done (Kai)
  - Route discovery now uses A* with capacity-aware weights to produce high-quality route matrices (3+ hops).
  - Feature flag: `feature_flag_sor_v2` in config.toml

- [x] **Task 2 – Sampling + Interpolation for Orderbook** ✅ Done (Kai)
  - Replace chunking with sampling + interpolation approach for orderbook generation.
  - Works with 3+ hops (chunking only worked well with 2 hops).
  - `est_swap_with_smart_routing` generates orderbook with sampling + interpolation.

- [x] **Task 3 – Reduce Orderbook Payload 75%** ✅ Done (Kai)
  - Bug fix: Reduce orderbook payload size by 75%.
  - Not directly related to SOR v2, but impacts performance with 3+ hops.
  - Optimizes network transfer and frontend processing.

- [x] **Task 4.1 – Quick Demo: Route Splitting in Orderbook** ✅ Done (Kai)
  - Quick implementation: Add route splitting for a few sample amounts in orderbook.
  - Generate `split_entries` (sampled Waterfill allocations) alongside traditional order book entries.
  - Purpose: Demonstrate why separate API is needed (CPU/RAM overhead when calculating splits for all entries).
  - Shows performance impact of route splitting in orderbook vs separate API.

- [ ] **Task 4.2 – Route Splitting API in Backend** 🚧 In Progress (Kafka)
  - Implement `est_route_split` function in `liquid_pool.rs`.
  - Waterfill algorithm for optimal route splitting.
  - Kafka topic `sc.est-route-split` returns exact Waterfill splits for `routeMatrix` + `amountIn`.
  - Separate API for on-demand calculation (efficient, real-time).

- [ ] **Task 5 – Display Engine Endpoint `sc.est-route-split`** 🚧 In Progress (Kafka)
  - Display Engine exposes REST/WebSocket endpoint that forwards requests to backend topic.
  - Handles correlation IDs and caches responses per client request.

- [ ] **Task 6 – Frontend Gateway Integration** 🚧 In Progress (Kafka)
  - Frontend swaps call the Display Engine endpoint to retrieve precise split allocations for the user-entered amount before displaying results.

- [ ] **Task 7 – Swap UI Route Breakdown** 🚧 In Progress (Kafka)
  - Swap page shows per-route allocation and output when user clicks the hop indicator.
  - Data fetched via Task 6 endpoint to reflect real-time Waterfill.

- [ ] **Task 8 – Swap Execution with Split Routes** 🚧 In Progress (Kafka)
  - Swap submission flow uses Task 6 response to construct multi-route transaction payload.
  - Submits smart-contract call with split routes.

---

**Notes**
- Task 4.1: Quick demo to prove separate API approach (shows CPU/RAM overhead).
- Task 4.2: Production-ready API implementation.
- Tasks 5–8 depend on Task 4.2 API being stable.
- Waterfill chunk count controlled by backend constant; adjust if Display Engine needs denser sampling.