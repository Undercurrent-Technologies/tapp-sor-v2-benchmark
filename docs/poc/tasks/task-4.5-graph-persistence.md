# Task 4.5: Graph Persistence (OPTIONAL)

> **Story Points:** 3 (Easy)  
> **Priority:** 🟢 LOW  
> **Depends:** Task 4 (event listener)  
> **Phase:** 2.1

---

## 🎯 Goal

Save/load graph for fast restart

---

## 📋 Subtasks

### **4.5.1. Auto-save Graph**

#### Implementation Guide:

```rust
File: NEW - tapp/backend/src/utils/graph_persistence.rs

// Purpose: Periodically save graph to disk
// Why: Fast restart after server crash/restart
//
// Implementation:
//   - Serialize graph to JSON
//   - Write to file (e.g. ./data/graph.json)
//   - Run in background task, save every 5 minutes
//
// Benefit: Restart without rebuilding graph from DB

Example: Graph with 200 pools = ~100KB file
```

---

### **4.5.2. Load on Startup**

#### Implementation Guide:

```rust
// Purpose: Load saved graph on startup (if exists)
// 
// Flow:
//   1. Check if graph file exists
//   2. If yes → Load from file → Cache it
//   3. If no → Build from DB (first time)
//
// Then: Sync to current block (see 4.5.3)

Benefit: 
  - Without persistence: Build from DB (~500ms)
  - With persistence: Load from file (~50ms) + sync
  - 10× faster startup!
```

---

### **4.5.3. Sync from Saved Block**

#### Implementation Guide:

```rust
// Purpose: Update loaded graph to current blockchain state
// Why: Saved graph may be outdated (5-10 min old)
//
// Steps:
//   1. Load graph from file (saved at block N)
//   2. Get events from block N → current block
//   3. Replay events to update graph
//   4. Graph now synchronized!
//
// Example:
//   Saved at block 1000 (5 min ago)
//   Current block 1005
//   Replay 5 blocks of events (~50-100 events)
//   Graph updated to block 1005

Result: Fast startup + fresh graph
```

---

## ✅ Definition of Done

- [ ] Graph auto-save implemented
- [ ] Graph load on startup
- [ ] Event replay for sync
- [ ] Fast restart validated (<1s)

---

**Back to:** [Implementation Overview](../IMPLEMENTATION-TASKS-BREAKDOWN.md)

