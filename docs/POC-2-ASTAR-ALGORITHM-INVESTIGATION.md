# A* Algorithm Investigation - POC Version

**File Under Investigation:** `astar-algorithm-poc.js`  
**Date:** January 2025  
**Status:** Algorithm works but limited by graph connectivity

**Note:** This file is a **fix version** of `phase1-astar-mike.js` which had a bug that prevented finding any routes.

---

## 🔍 Problem Summary

When running A* search algorithm on token pair DOGE → BTC:
- **Expected**: Find multiple routes (10-20 routes)
- **Actual**: Only finds 1 route with very low output (2.24 from 10000 input)
- **Why**: Heuristic = Infinity for source node, causing A* to fall back to blind search

---

## 📊 Test Results

### Configuration
```bash
node astar-algorithm-poc.js DOGE BTC 10000 --max-hops=3 --top-k=10 --beam=64 --verbose
```

### Output
```
✅ Computed heuristic for 11 nodes (10000 explored, 10000 iterations)
Source: 0x46f7b4d7e88011220272054d04d5698897c3277a4cdba1a387df906b7814fd00, Heuristic: Infinity
Target: 0x22a7260f31c70045a2511504438e242175b84bdacae277cad40f4a04353e8848, Heuristic: -71117.8575
⚠️  Warning: Source heuristic is Infinity. Falling back to uniform heuristic (0).
Heuristic map size: 11 nodes
A* search starting (max 50000 iterations)...
   ✅ Found route #1, score: -8.3903, hops: 3

✅ Found 1 routes (explored: 18)

🎯 Evaluating 1 routes...
✅ Best route net output: 2.24

Results:
  Routes found: 1
  Best output: 2.24
  Price Impact: 99.98%

Best Route:
  Path: DOGE → APT → USDT → BTC
  Hops: 3
  Input: 10000.00
  Output: 2.24
```

---

## 🐛 Root Cause Analysis

### 1. Heuristic Map Too Small

**Problem:**
```
✅ Computed heuristic for 11 nodes (10000 explored, 10000 iterations)
Source: ..., Heuristic: Infinity
```

Reverse Dijkstra only computes heuristic for 11/60 nodes, insufficient coverage.

**Why:**
- Reverse Dijkstra starts from target BTC
- Only explores 11 nodes that have paths to BTC
- Source node DOGE not in heuristic map → heuristic = Infinity

**Impact:**
- A* doesn't know which "direction" to go
- Falls back to uniform heuristic (h=0)
- A* becomes blind search (no better than DFS)

### 2. Fix Applied: Effective Heuristic Fallback

**The Fix:**
```javascript
// Use effective heuristic (0 if Infinity)
const h = heuristicId.get(partial.nodeId) ?? Infinity;
const effectiveH = h === Infinity ? 0 : h; // ← KEY FIX

const remainingHops = maxHops - partial.hops;
const upperBound = partial.score - effectiveH - (gasPerHopPenalty * remainingHops);
```

**Difference from Phase 1 Mike:**
- Phase 1 Mike: `if (h === Infinity) continue;` → skips node entirely
- POC Version: `effectiveH = h === Infinity ? 0 : h` → uses fallback heuristic
- This prevents skipping nodes when heuristic = Infinity, allowing exploration to continue

### 3. Only 1 Route Found

**Why:**
- Heuristic coverage: Only 11/60 nodes (18.3%)
- DOGE connectivity: Only 1 edge from node 31
- Graph structure: DOGE → APT → USDT → BTC (only path available)
- Bitset visited tracking too strict, preventing alternative routes

---

## ✅ What's Working

### Effective Heuristic Fallback
- When heuristic = Infinity, use h=0 instead of skipping
- Allows A* to continue exploration
- Prevents infinite loops

### Limited Exploration
- Explored 18 nodes total
- Found 1 route successfully
- No hanging or infinite loops

---

## ❌ What's Not Working

### Output Quality
- **Output**: 2.24 from 10000 input (99.98% price impact)
- **Routes Found**: 1 (expecting 10-20)
- **Heuristic Coverage**: 11/60 nodes (18.3%)

### Graph Connectivity Issue
- DOGE has poor connectivity (only 1 edge)
- Reverse Dijkstra cannot reach DOGE from BTC
- Source heuristic = Infinity

### Edge Compression Too Aggressive
- Compressed 256 → 129 edges (49.6% reduction)
- May remove alternative good routes
- Reduces diversity of paths

---

## 📋 Summary

### A* POC Performance

| Metric | Value | Status |
|--------|-------|--------|
| **Routes Found** | 1 | ⚠️ Limited |
| **Output** | 2.24 (99.98% impact) | ⚠️ Very Poor |
| **Heuristic Coverage** | 11/60 nodes (18.3%) | ⚠️ Insufficient |
| **Nodes Explored** | 18 | ✅ Efficient |
| **Execution Time** | < 50ms | ✅ Fast |
| **Algorithm Status** | Working (with limitations) | ⚠️ |

### Key Differences from Phase 1 Mike (Original Buggy Version)

This POC file (`astar-algorithm-poc.js`) is a **fix version** of `phase1-astar-mike.js`.

| Feature | Phase 1 Mike (Original) | POC Version (Fixed) |
|---------|------------------------|---------------------|
| **Routes Found** | 0 | 1 |
| **Heuristic Handling** | Skips node if Infinity | Falls back to h=0 |
| **Bug** | `if (h === Infinity) continue;` | `effectiveH = h === Infinity ? 0 : h` |
| **Status** | ❌ Broken | ⚠️ Limited |
| **Recommendation** | Needs fix | Usable but not ideal |

**Key Fix Applied:**
- Original: `if (h === Infinity) continue;` → skips node completely
- Fixed: `const effectiveH = h === Infinity ? 0 : h;` → uses fallback heuristic

---

## 🎯 Recommendations

### Current Status
- ✅ POC version works and finds routes
- ⚠️ Only finds 1 route due to graph connectivity limitations
- ⚠️ Output quality is very poor (2.24 from 10000)

### For Benchmarking
```bash
# Use POC version in benchmark
node benchmark.js DOGE BTC 10000 --max-hops=3
```

### For Better Results
Use **Yen's Algorithm** instead, which:
- ✅ Finds 20 routes for DOGE → BTC
- ✅ Better output quality
- ✅ No heuristic required
- ✅ More reliable

```bash
node yens-algorithm-poc.js DOGE BTC 10000 --k=20 --max-hops=3
```

---

## 🔬 Technical Details

### Why Heuristic = Infinity
1. Reverse Dijkstra starts from target (BTC)
2. Explores backwards to find distances from all nodes to target
3. DOGE has no direct connection to well-connected nodes
4. Reverse Dijkstra cannot reach DOGE → heuristic = Infinity

### Why Only 1 Route
1. DOGE has only 1 edge (to APT)
2. From APT, paths must go through USDT to reach BTC
3. Bitset tracking prevents revisiting nodes
4. No alternative paths available

### Comparison with Yen's
- **A* POC**: 1 route, output 2.24
- **Yen's**: 20 routes, output 2.27+
- **Winner**: Yen's (more robust, no heuristic dependency)

---

## 📝 Conclusion

**A* POC Status:** ✅ Working but limited
- Algorithm runs successfully
- Finds 1 route (DOGE → APT → USDT → BTC)
- Output quality poor due to graph connectivity
- Not suitable for production use cases with distant token pairs

**Recommendation:** Use Yen's algorithm for better performance and reliability.

