# A* Algorithm Investigation - Phase 1 (Mike) Implementation

**File Under Investigation:** `phase1-astar-mike.js`  
**Date:** January 2025  
**Status:** Algorithm finds 0 routes

---

## 🔍 Problem Summary

When running A* search algorithm on token pair DOGE → BTC:
- **Expected**: Find at least 1 route (like POC version)
- **Actual**: Found 0 routes
- **Why**: Algorithm logic issue - frontier empty before finding routes

---

## 📊 Test Results

### Configuration
```bash
node phase1-astar-mike.js DOGE BTC 10000 --max-hops=3 --top-k=10 --beam=64 --verbose
```

### Output
```
✅ Computed heuristic for 11 nodes (10000 nodes explored, 10000 iterations)
Source ID: 0x46f7b4d7e88011220272054d04d5698897c3277a4cdba1a387df906b7814fd00, Heuristic: Infinity
Target ID: 0x22a7260f31c70045a2511504438e242175b84bdacae277cad40f4a04353e8848, Heuristic: -71117.8575
⚠️  Warning: Heuristic is Infinity. Falling back to uniform heuristic (0).
Heuristic map size: 11 nodes
A* search starting (max 50000 iterations)...

✅ Found 0 routes
📊 A* Search Statistics:
  Frontier priority range: [Infinity, -Infinity]
  K-th best score: -Infinity
  Pruning effectiveness: 50.0%
❌ No routes found!
```

---

## 🐛 Root Cause Analysis

### Issue: Frontier Becomes Empty Immediately

**Problem:**
- Frontier heap starts with 1 node (source)
- After first iteration, frontier becomes empty
- No routes found

**Why:**
Looking at the code in `findTopKRoutesAStar`:
- Line 555-560: Check `if (partial.hops >= maxHops)` - but this is checked AFTER popping from frontier
- Line 562-565: Check `if (h === Infinity) continue;` - **THIS IS THE PROBLEM**
- Line 576-578: Only explore edges if conditions pass, but all nodes have h=Infinity

**The Bug:**
```javascript
const h = heuristicId.get(partial.nodeId) ?? Infinity;
if (h === Infinity) continue; // ← SKIPS NODE IF HEURISTIC = INFINITY
```

When source heuristic = Infinity and we push source to frontier, the next iteration will check if h === Infinity and **skip it**, preventing exploration.

---

---

## 💡 The Bug Explained

**Current Code in `phase1-astar-mike.js`:**
```javascript
const h = heuristicId.get(partial.nodeId) ?? Infinity;
if (h === Infinity) continue; // ← SKIPS THE NODE ENTIRELY
```

**Problem:** When heuristic = Infinity, this line skips the node completely, preventing any exploration from that node.

**Why This Happens:**
1. Source node (DOGE) has heuristic = Infinity
2. Algorithm pushes source to frontier with h=0 fallback
3. But when expanding, checks `if (h === Infinity) continue`
4. All child nodes also get h=Infinity
5. All nodes get skipped → frontier becomes empty
6. No routes found

---

## 🔧 Recommended Fix

### The Fix: Use Effective Heuristic Instead of Skipping

Replace the skipping logic with fallback heuristic:

```javascript
// CURRENT CODE (Line 562-565):
const h = heuristicId.get(partial.nodeId) ?? Infinity;
if (h === Infinity) continue; // ← This skips the node!

// FIXED VERSION:
const h = heuristicId.get(partial.nodeId) ?? Infinity;
const effectiveH = h === Infinity ? 0 : h; // ← Fallback to 0
const remainingHops = maxHops - partial.hops;
const upperBound = partial.score - effectiveH - (gasPerHopPenalty * remainingHops);
```

**Also fix for next nodes (Line ~590):**
```javascript
// CURRENT:
const hRem = heuristicId.get(nextNodeId) ?? Infinity;
const prio = newScore - hRem - (gasPerHopPenalty * rem);

// FIXED:
const hRem = heuristicId.get(nextNodeId) ?? Infinity;
const effectiveHRem = hRem === Infinity ? 0 : hRem;
const prio = newScore - effectiveHRem - (gasPerHopPenalty * rem);
```

### Why This Works
- Instead of skipping nodes with Infinity heuristic, use h=0
- Allows exploration to continue even when heuristic is unavailable
- Prevents frontier from becoming empty prematurely

---

## 🎯 Conclusion

**Phase 1 Mike** (`phase1-astar-mike.js`): Currently finds 0 routes due to bug where it skips nodes with Infinity heuristic.

**Fix Required:** Apply effective heuristic fallback (h=0) instead of skipping nodes.

**Status After Fix:** Should find at least 1 route like the POC version.

