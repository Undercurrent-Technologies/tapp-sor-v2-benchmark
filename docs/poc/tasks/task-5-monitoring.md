# Task 5: Monitoring & Alerting (RECOMMENDED)

> **Story Points:** 2 (Simple)  
> **Priority:** 🟡 MEDIUM  
> **Depends:** Task 1, 2, 3  
> **Phase:** 2.1

---

## 🎯 Goal

Track performance and issues

---

## 📋 Subtasks

### **5.1. Add Prometheus Metrics**

#### Implementation Guide:

```rust
File: tapp/backend/src/worker/order_book_worker.rs

// Purpose: Track SOR V2 performance metrics
//
// Metrics to add:
//   1. graph_update_total (Counter)
//      - Count graph updates from events
//      - Target: ~10-15% of events
//
//   2. astar_search_duration_ms (Histogram)
//      - Measure A* search time
//      - Target: <50ms (p99)
//
//   3. route_split_duration_ms (Histogram)
//      - Measure route splitting time (Phase 2.2)
//      - Target: <100ms (p99)
//
// Usage pattern:
//   - Increment counter on graph update
//   - Start timer → execute → observe duration

Dashboard: Visualize in Grafana
```

**Deliverable:** Prometheus metrics

---

### **5.2. Configure Alerts**

#### Implementation Guide:

```yaml
File: prometheus/alerts.yml (or similar)

// Purpose: Alert on performance issues
//
// Alert 1: High Graph Update Rate
//   Condition: Update rate > 20% (expected ~10-15%)
//   Action: Check if spot price logic is correct
//
// Alert 2: High A* Latency
//   Condition: p99 latency > 100ms (expected <50ms)
//   Action: Check graph size, optimize A* implementation
//
// Alert 3: High Split Latency (Phase 2.2)
//   Condition: p99 latency > 200ms
//   Action: Optimize Waterfill/Hillclimb

Benefits: Early detection of performance issues
```

**Deliverable:** Alert rules

---

## ✅ Definition of Done

- [ ] Prometheus metrics added
- [ ] Grafana dashboards created
- [ ] Alerts configured
- [ ] Alert testing passed

---

**Back to:** [Implementation Overview](../IMPLEMENTATION-TASKS-BREAKDOWN.md)

