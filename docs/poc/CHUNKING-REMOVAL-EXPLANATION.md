# Chunking Removal in Phase 2 - Complete Explanation

> **Understanding why chunking is removed in Phase 2 and its impact**
> 
> Last Updated: October 28, 2025

---

## 🎯 TL;DR - Quick Understanding

### **Why is chunking removed in Phase 2?**

```
✅ PRIMARY REASON: Hops > 3 breaks chunking assumption

❌ NOT BECAUSE OF: Pathfinding algorithm choice
```

### **Key Points:**

1. **Chunking depends on HOPS, not pathfinding algorithm:**
   - ✅ Works with 1-2 hops (routes stable for nearby amounts)
   - ❌ Fails with 3+ hops (routes change frequently)
   - Works with ANY pathfinding algorithm

2. **Why Phase 2 changes both:**
   ```
   Phase 2 goal: Support 3-5 hops (find better routes)
     ↓
   3-5 hops requires: Better pathfinding algorithm
     ↓
   3-5 hops also means: Must remove chunking (assumption breaks)
   ```

3. **These are SEPARATE changes:**
   - **New pathfinding algorithm** = Find K routes instead of 1 (algorithm improvement)
   - **Remove Chunking** = Hops > 3 breaks optimization (technical necessity)

4. **Hypothetical scenario to prove independence:**
   ```javascript
   // If Phase 1 kept same algorithm but increased hops:
   Algorithm: Same pathfinding algorithm
   Hops: 3+
   Result: Chunking would STILL fail and need removal
   
   // If Phase 2 used new algorithm but limited hops:
   Algorithm: Different pathfinding algorithm
   Hops: 2
   Result: Chunking would STILL work and could be kept
   ```

### **Impact on Frontend:**

```
✅ ZERO changes needed!

Frontend only cares about entries structure:
  Phase 1: { amounts, routeIdx, prices }
  Phase 2: { amounts, routeIdx, prices }  ← SAME!

How backend generates entries? Frontend doesn't know/care!
```

---

## 📋 Table of Contents

1. [What is Chunking?](#what-is-chunking)
2. [Chunking vs Entries](#chunking-vs-entries)
3. [Why Chunking Works in Phase 1](#why-chunking-works-in-phase-1)
4. [Why Chunking Fails in Phase 2](#why-chunking-fails-in-phase-2)
5. [Concrete Simulation: 2 Hops vs 3+ Hops](#concrete-simulation-2-hops-vs-3-hops)
6. [Frontend Impact Analysis](#frontend-impact-analysis)
7. [Smart Contract Impact Analysis](#smart-contract-impact-analysis)
8. [Summary](#summary)

---

## What is Chunking?

### **Definition:**

**Chunking** = Backend optimization technique to generate OrderBook entries faster by **testing only a subset of amounts** and applying results to nearby amounts.

### **Core Concept:**

```javascript
// Without Chunking: Test EVERY amount
amounts = [10, 20, 30, ..., 10000];  // 1000 amounts
for (const amount of amounts) {
  testAllRoutes(amount);  // 1000 tests
}
// Time: ~2000ms

// With Chunking: Test FIRST in each chunk
chunks = [
  [10, 20, ..., 1000],      // Chunk 0: test 10 only
  [1010, 1020, ..., 2000],  // Chunk 1: test 1010 only
  ...
  [9010, 9020, ..., 10000]  // Chunk 9: test 9010 only
];

for (const chunk of chunks) {
  const bestRoute = testAllRoutes(chunk[0]);  // Test FIRST only
  applyToAll(chunk, bestRoute);                // Apply to ALL 100 amounts
}
// Tests: 10 only (instead of 1000)
// Time: ~50ms (40× faster!)
```

### **Key Assumption:**

```
"Amounts that are CLOSE to each other will use the SAME best route"

Example:
  - 100 APT uses Route 0? → Assume 101, 102, ..., 110 also use Route 0
  - No need to test each individually
```

---

## Chunking vs Entries

### **What are entries and why do we need them?**

#### **Purpose from Frontend perspective:**

```javascript
// User types: 105 APT
// Frontend needs to know: "How much USDC will I get?"
// 
// Problem: Can't calculate on frontend (no pool data)
// Solution: Backend pre-calculates a PRICE LADDER (entries)

entries = [
  { amounts: [10, 495], routeIdx: 0 },    // 10 APT → 495 USDC
  { amounts: [20, 990], routeIdx: 0 },    // 20 APT → 990 USDC
  ...
  { amounts: [100, 4950], routeIdx: 1 },  // 100 APT → 4950 USDC
  { amounts: [105, 5197], routeIdx: 1 },  // 105 APT → 5197 USDC ← Closest!
  ...
]

// Frontend: Find closest entry → interpolate → show user estimate
```

**entries = Pre-calculated price points that frontend uses to estimate swap output**

#### **How entries are created on Backend:**

**File:** `tapp-sor/src/services/orderbook-generator.ts` (or equivalent)

**Function:** `generateOrderBook()`

**Purpose:** Build price ladder (entries) for a token pair

**Input:**
- `tokenA`, `tokenB`: Token pair (e.g., APT, USDC)
- `maxAmount`: Maximum amount to generate entries for (e.g., 10,000 APT)
- `numEntries`: How many price points to create (e.g., 1000)
- `routes`: Available routes (from pathfinding algorithm)

**Process (high-level):**
1. Create amount array: `[10, 20, 30, ..., 10000]` (1000 points)
2. For each amount:
   - Test all available routes
   - Pick route with best output
   - Create entry: `{ amounts: [input, output], routeIdx: bestRoute }`
3. Return entries array

**Output:**
```javascript
entries = [
  { amounts: [input, output], routeIdx: X, prices: [...] },
  // ... 1000 entries
]
```

**Note:** Chunking is an OPTIMIZATION in step 2 - instead of testing all amounts, test subset and apply to chunk.

---

### **Critical Understanding:**

```javascript
// ❌ WRONG:
"chunking creates entries"
"no chunking = no entries"

// ✅ CORRECT:
"entries are ALWAYS created (with or without chunking)"
"chunking is HOW entries are generated (optimization method)"
```

### **Relationship Diagram:**

```
┌─────────────────────────────────────────────────┐
│ Backend Goal: Create 1000 entries               │
└────────────────┬────────────────────────────────┘
                 ↓
       ┌─────────┴─────────┐
       │                   │
       ▼                   ▼
┌─────────────┐    ┌──────────────┐
│ Method 1:   │    │ Method 2:    │
│ Chunking    │    │ No Chunking  │
│ (Phase 1)   │    │ (Phase 2.1)  │
└──────┬──────┘    └──────┬───────┘
       │                   │
       ▼                   ▼
    Faster              Slower
  (fewer tests)      (more tests)
       │                   │
       ▼                   ▼
   Less Accurate      More Accurate
       │                   │
       └────────┬──────────┘
                ↓
       ┌────────────────┐
       │  Same Output:  │
       │  1000 entries  │
       └────────────────┘
                ↓
         Send to Frontend
```

### **Key Points:**

| Aspect | Reality |
|--------|---------|
| **entries existence** | ✅ Always created (both methods) |
| **entries structure** | ✅ Same `{ amounts, routeIdx, prices }` |
| **entries count** | ✅ Same (1000 entries) |
| **chunks existence** | ⚠️ Internal backend tool only |
| **chunks sent to frontend** | ❌ Never sent |
| **frontend sees chunks** | ❌ Never sees them |

---

## Why Chunking Works in Phase 1

### **Phase 1 Characteristics:**

```javascript
Max hops: 2
Routes: Simple (APT → USDC, APT → WETH → USDC)
Liquidity: Deep pools
Price impact: Predictable, gradual
```

### **Chunking Assumption Holds:**

```javascript
// Pool APT-USDC (direct swap)
// Reserve: 100k APT ↔ 5M USDC

// Test amounts in chunk [100-200]:
Amount 100: Route 0 (direct) = 4,950 USDC ← Best
Amount 110: Route 0 (direct) = 5,445 USDC ← Still best
Amount 120: Route 0 (direct) = 5,940 USDC ← Still best
Amount 150: Route 0 (direct) = 7,425 USDC ← Still best
Amount 200: Route 0 (direct) = 9,900 USDC ← Still best

// ✅ Same route for entire chunk!
// Chunking assumption: VALID
```

### **Why it works:**

1. **Limited routes (2):** Not many alternatives
2. **Shallow routing (2 hops):** Predictable behavior
3. **Deep liquidity:** Price impact gradual
4. **Stable ranking:** Best route stays best for nearby amounts

---

## Why Chunking Fails in Phase 2

### **Phase 2.1 Characteristics:**

```javascript
Max hops: 5
Routes: Complex (K=5 routes with 3-5 hops)
Liquidity: Fragmented across multiple pools
Price impact: Non-linear, compounds across hops
```

### **Chunking Assumption Breaks:**

```javascript
// Multiple routes available (K=5):
Route 0: APT → USDC (direct, 1 hop)
Route 1: APT → WETH → USDC (2 hops)
Route 2: APT → BTC → ETH → USDC (3 hops)
Route 3: APT → MOVE → CAKE → USDC (3 hops)
Route 4: APT → SOL → BTC → ETH → USDC (4 hops)

// Test amounts in same chunk [100-200]:
Amount 100: 
  Route 0: 4,950 USDC ← Best (direct is good for small)
  Route 1: 4,900 USDC
  Route 2: 4,850 USDC
  
Amount 120:
  Route 0: 5,880 USDC (price impact kicks in!)
  Route 1: 5,940 USDC ← Best NOW! (multi-hop better)
  Route 2: 5,820 USDC
  
Amount 150:
  Route 0: 7,200 USDC (worse price impact)
  Route 1: 7,350 USDC
  Route 2: 7,500 USDC ← Best NOW! (3 hops optimal)
  
Amount 200:
  Route 0: 9,400 USDC
  Route 1: 9,700 USDC
  Route 2: 10,000 USDC ← Still best (3 hops wins)

// ❌ Different routes for amounts in SAME chunk!
// Chunking assumption: INVALID
```

### **Problems with Chunking in Multi-hop:**

#### **1. Compounding Price Impact**

```javascript
// 1 hop: Linear price impact
Pool APT-USDC: 100 → 4,950 (1% impact)
               200 → 9,800 (2% impact)

// 3 hops: Compound price impact
Pool APT-BTC:  100 → 0.1 BTC (1% impact)
Pool BTC-ETH:  0.1 → 1.6 ETH (1% impact on this pool)
Pool ETH-USDC: 1.6 → 5,200 USDC (1% impact on this pool)
Total impact: 1% × 1% × 1% ≈ 3% (non-linear!)

// Small amount change → big impact change
```

#### **2. Liquidity Fragmentation**

```javascript
// Direct route: Single deep pool
APT-USDC: 100k APT ↔ 5M USDC (deep!)
  → Stable for 100-200 APT range

// Multi-hop route: Multiple shallow pools
APT-BTC:  10k APT ↔ 100 BTC (medium)
BTC-ETH:  50 BTC ↔ 800 ETH (shallow!)  ← Bottleneck!
ETH-USDC: 500 ETH ↔ 1.6M USDC (medium)
  → Unstable! Route ranking changes quickly
```

#### **3. Route Diversity**

```javascript
// Phase 1: 2 routes
// If Route 0 bad → only 1 alternative (Route 1)
// Ranking stable

// Phase 2.1: 5 routes (K=5)
// If Route 0 bad → 4 alternatives!
// Each with different hop counts (1-5 hops)
// Ranking changes frequently as amount increases
```

### **Concrete Example - Chunking WRONG:**

```javascript
// Chunk: [100, 105, 110, 115, 120]
// Phase 2.1 with chunking (WRONG):

// Test amount 100 only:
Route 0: 4,950 USDC ← Best
// Apply Route 0 to ALL:

entries = [
  { amounts: [100, 4950], routeIdx: 0 },  // ✅ Correct
  { amounts: [105, 5197], routeIdx: 0 },  // ❌ Should be Route 1 (5,220)
  { amounts: [110, 5444], routeIdx: 0 },  // ❌ Should be Route 1 (5,460)
  { amounts: [115, 5690], routeIdx: 0 },  // ❌ Should be Route 2 (5,750)
  { amounts: [120, 5936], routeIdx: 0 }   // ❌ Should be Route 2 (6,000)
]

Total output: 26,217 USDC
Lost opportunity: 1,163 USDC (-4.4%)
```

```javascript
// Phase 2.1 without chunking (CORRECT):

// Test EVERY amount:
entries = [
  { amounts: [100, 4950], routeIdx: 0 },   // Route 0
  { amounts: [105, 5220], routeIdx: 1 },   // Route 1 (switched!)
  { amounts: [110, 5460], routeIdx: 1 },   // Route 1
  { amounts: [115, 5750], routeIdx: 2 },   // Route 2 (switched!)
  { amounts: [120, 6000], routeIdx: 2 }    // Route 2
]

Total output: 27,380 USDC
Gain: +1,163 USDC (+4.4%)
```

---

## Concrete Simulation: 2 Hops vs 3+ Hops

### **Scenario: Swap APT → USDC with different amounts**

Let's simulate backend generating entries for chunk `[100, 110, 120, 130, 140 APT]`

---

### **Available Pools (with liquidity data):**

```javascript
// Direct pool (shallow - will have price impact)
Pool_APT_USDC_Direct = {
  reserves: { APT: 1_000, USDC: 50_000 },
  type: "AMM",
  formula: "output = (reserve_out × amount_in) / (reserve_in + amount_in)"
}

// 2-hop path pools
Pool_APT_WETH = {
  reserves: { APT: 10_000, WETH: 500 },
  type: "AMM"
}
Pool_WETH_USDC = {
  reserves: { WETH: 1_000, USDC: 500_000 },
  type: "AMM"
}

// 3-hop path pools (deep liquidity!)
Pool_APT_BTC = {
  reserves: { APT: 50_000, BTC: 25 },
  type: "CLMM"
}
Pool_BTC_ETH = {
  reserves: { BTC: 100, ETH: 1_600 },
  type: "CLMM"
}
Pool_ETH_USDC = {
  reserves: { ETH: 5_000, USDC: 16_000_000 },
  type: "Stable"
}
```

---

### **Case 1: Chunking with 2 Hops ✅ WORKS**

**Available Routes:** Direct (1 hop), 2-hop via WETH

**Backend Process:**

```javascript
// Chunk: [100, 110, 120, 130, 140 APT]

// STEP 1: Test ONLY first amount (100 APT)
// Route 0: Direct APT → USDC
output0 = (50_000 × 100) / (1_000 + 100) = 4,545 USDC ✅ Best

// Route 1: APT → WETH → USDC
weth = (500 × 100) / (10_000 + 100) = 4.95 WETH
output1 = (500_000 × 4.95) / (1_000 + 4.95) = 2,465 USDC

// Best: Route 0 (4,545 > 2,465)

// STEP 2: Apply Route 0 to ALL amounts
entries_chunked = [
  { amounts: [100, 4545], routeIdx: 0 },
  { amounts: [110, 5000], routeIdx: 0 },
  { amounts: [120, 5455], routeIdx: 0 },
  { amounts: [130, 5909], routeIdx: 0 },
  { amounts: [140, 6364], routeIdx: 0 }
]

// VERIFY: Test each amount individually
// Amount 100:
Route 0: 4,545 USDC ✅ Best
Route 1: 2,465 USDC

// Amount 110:
Route 0: (50_000 × 110) / (1_000 + 110) = 4,955 USDC ✅ Best
Route 1: 2,711 USDC

// Amount 120:
Route 0: (50_000 × 120) / (1_000 + 120) = 5,357 USDC ✅ Best
Route 1: 2,958 USDC

// Amount 130:
Route 0: (50_000 × 130) / (1_000 + 130) = 5,752 USDC ✅ Best
Route 1: 3,204 USDC

// Amount 140:
Route 0: (50_000 × 140) / (1_000 + 140) = 6,140 USDC ✅ Best
Route 1: 3,451 USDC

// ✅ Result: ALL amounts use Route 0!
// Chunking assumption HOLDS!
```

**Why it works with 2 hops:**
- Direct pool has better rate despite shallow liquidity
- 2-hop path has worse overall rate
- For amounts 100-140, Route 0 consistently wins
- Price impact on direct pool is gradual and predictable

---

### **Case 2: Chunking with 3+ Hops ❌ FAILS**

**Available Routes:** Direct (1 hop), 2-hop via WETH, **3-hop via BTC-ETH (new!)**

**Backend Process:**

```javascript
// Chunk: [100, 110, 120, 130, 140 APT]

// STEP 1: Test ONLY first amount (100 APT)
// Route 0: Direct APT → USDC
output0 = (50_000 × 100) / (1_000 + 100) = 4,545 USDC ✅ Best

// Route 1: APT → WETH → USDC
output1 = 2,465 USDC

// Route 2: APT → BTC → ETH → USDC (3 hops, deep pools!)
// Hop 1: APT → BTC
btc = (25 × 100) / (50_000 + 100) = 0.04998 BTC
// Hop 2: BTC → ETH
eth = (1_600 × 0.04998) / (100 + 0.04998) = 0.798 ETH
// Hop 3: ETH → USDC (Stable pool = low slippage!)
output2 = (16_000_000 × 0.798) / (5_000 + 0.798) = 2,556 USDC

// Best at 100 APT: Route 0 (4,545 USDC)

// STEP 2: Apply Route 0 to ALL amounts (WRONG!)
entries_chunked = [
  { amounts: [100, 4545], routeIdx: 0 },
  { amounts: [110, 5000], routeIdx: 0 },
  { amounts: [120, 5455], routeIdx: 0 },
  { amounts: [130, 5909], routeIdx: 0 },
  { amounts: [140, 6364], routeIdx: 0 }
]

// VERIFY: Test EACH amount individually

// Amount 100:
Route 0: 4,545 USDC ✅ Best
Route 1: 2,465 USDC
Route 2: 2,556 USDC

// Amount 110:
Route 0: 4,955 USDC
Route 1: 2,711 USDC
Route 2:
  btc = (25 × 110) / (50_000 + 110) = 0.05497 BTC
  eth = (1_600 × 0.05497) / (100 + 0.05497) = 0.878 ETH
  usdc = (16_000_000 × 0.878) / (5_000 + 0.878) = 2,811 USDC
// Best: Route 0 (4,955) ✅

// Amount 120:
Route 0: 5,357 USDC
Route 1: 2,958 USDC
Route 2:
  btc = (25 × 120) / (50_000 + 120) = 0.05996 BTC
  eth = (1_600 × 0.05996) / (100 + 0.05996) = 0.958 ETH
  usdc = (16_000_000 × 0.958) / (5_000 + 0.958) = 3,067 USDC
// Best: Route 0 (5,357) ✅

// Amount 130: (Route 2 improving due to deep liquidity!)
Route 0: 5,752 USDC
Route 1: 3,204 USDC
Route 2:
  btc = (25 × 130) / (50_000 + 130) = 0.06495 BTC
  eth = (1_600 × 0.06495) / (100 + 0.06495) = 1.038 ETH
  usdc = (16_000_000 × 1.038) / (5_000 + 1.038) = 3,322 USDC
// Best: Route 0 (5,752) ✅ but gap narrowing!

// Amount 140: (Crossover approaching!)
Route 0: 6,140 USDC
Route 1: 3,451 USDC
Route 2:
  btc = (25 × 140) / (50_000 + 140) = 0.06994 BTC
  eth = (1_600 × 0.06994) / (100 + 0.06994) = 1.118 ETH
  usdc = (16_000_000 × 1.118) / (5_000 + 1.118) = 3,578 USDC
// Best: Route 0 (6,140) ✅ but Route 2 gaining!

// Amount 150: (Outside chunk, for illustration)
Route 0: (50_000 × 150) / (1_000 + 150) = 6,522 USDC
Route 2:
  btc = (25 × 150) / (50_000 + 150) = 0.07493 BTC
  eth = (1_600 × 0.07493) / (100 + 0.07493) = 1.198 ETH
  usdc = (16_000_000 × 1.198) / (5_000 + 1.198) = 3,834 USDC
// Still Route 0 wins

// Amount 200:
Route 0: (50_000 × 200) / (1_000 + 200) = 8,333 USDC (price impact!)
Route 2:
  btc = (25 × 200) / (50_000 + 200) = 0.09988 BTC
  eth = (1_600 × 0.09988) / (100 + 0.09988) = 1.597 ETH
  usdc = (16_000_000 × 1.597) / (5_000 + 1.597) = 5,111 USDC
// Still Route 0 wins but gap closing fast!

// Amount 300:
Route 0: (50_000 × 300) / (1_000 + 300) = 11,538 USDC (heavy impact!)
Route 2:
  btc = (25 × 300) / (50_000 + 300) = 0.14963 BTC
  eth = (1_600 × 0.14963) / (100 + 0.14963) = 2.395 ETH
  usdc = (16_000_000 × 2.395) / (5_000 + 2.395) = 7,663 USDC
// Still Route 0 but Route 2 much closer! (66% of Route 0)

// Amount 500:
Route 0: (50_000 × 500) / (1_000 + 500) = 16,667 USDC (severe impact!)
Route 2:
  btc = (25 × 500) / (50_000 + 500) = 0.24752 BTC
  eth = (1_600 × 0.24752) / (100 + 0.24752) = 3.960 ETH
  usdc = (16_000_000 × 3.960) / (5_000 + 3.960) = 12,672 USDC
// Still Route 0 but Route 2 at 76%!

// Amount 1000:
Route 0: (50_000 × 1000) / (1_000 + 1000) = 25,000 USDC (extreme impact!)
Route 2:
  btc = (25 × 1000) / (50_000 + 1000) = 0.49020 BTC
  eth = (1_600 × 0.49020) / (100 + 0.49020) = 7.811 ETH
  usdc = (16_000_000 × 7.811) / (5_000 + 7.811) = 24,964 USDC
// Route 0 still wins (25,000 > 24,964) but gap tiny (0.14%)!

// Amount 1500: (CROSSOVER POINT!)
Route 0: (50_000 × 1500) / (1_000 + 1500) = 30,000 USDC
Route 2:
  btc = (25 × 1500) / (50_000 + 1500) = 0.72816 BTC
  eth = (1_600 × 0.72816) / (100 + 0.72816) = 11.565 ETH
  usdc = (16_000_000 × 11.565) / (5_000 + 11.565) = 36,904 USDC
// ✅✅✅ Route 2 WINS! (36,904 > 30,000)

// If chunk was [100, 500, 1000, 1500]:
// - Chunking would pick Route 0 for ALL (based on 100 APT test)
// - But 1500 APT should use Route 2 (23% better!)
// - Lost: 36,904 - 30,000 = 6,904 USDC!
```

**Comparison: Chunked vs Correct**

```javascript
// Chunk: [100, 110, 120, 130, 140, ..., 1000, 1500]

// With Chunking (WRONG):
entries_chunked = [
  { amounts: [100, 4545], routeIdx: 0 },    // ✅ Correct
  { amounts: [110, 4955], routeIdx: 0 },    // ✅ Correct
  { amounts: [120, 5357], routeIdx: 0 },    // ✅ Correct
  { amounts: [130, 5752], routeIdx: 0 },    // ✅ Correct
  ...
  { amounts: [1000, 25000], routeIdx: 0 },  // ⚠️ OK but Route 2 close
  { amounts: [1500, 30000], routeIdx: 0 }   // ❌ WRONG! Should use Route 2!
]

// Without Chunking (CORRECT):
entries_correct = [
  { amounts: [100, 4545], routeIdx: 0 },    // Route 0 best
  { amounts: [110, 4955], routeIdx: 0 },    // Route 0 best
  { amounts: [120, 5357], routeIdx: 0 },    // Route 0 best
  { amounts: [130, 5752], routeIdx: 0 },    // Route 0 best
  ...
  { amounts: [1000, 25000], routeIdx: 0 },  // Route 0 still best
  { amounts: [1500, 36904], routeIdx: 2 }   // Route 2 best! ✅
]

// Loss with chunking at 1500 APT:
// 36,904 - 30,000 = 6,904 USDC (23% loss!)
```

---

### **Summary: Why Chunking Fails with 3+ Hops**

#### **2 Hops (✅ Works):**
```
Direct pool (shallow): Best for small amounts
2-hop path: Consistently worse due to 2× fees + slippage

Result: Route ranking STABLE across amounts
→ Chunking assumption HOLDS
```

#### **3+ Hops (❌ Fails):**
```
Direct pool (shallow): Best for SMALL amounts, but severe price impact for LARGE
3-hop path (deep pools): Bad for small, but SCALES BETTER for large amounts!

Result: Route ranking CHANGES as amount increases
→ Chunking assumption BREAKS

Why?
1. Compounding effects: 3 hops = 3× opportunities for optimization
2. Deep multi-hop pools: Handle large amounts better
3. Shallow direct pool: Price impact grows non-linearly
4. Crossover point: Different amounts need different routes
```

#### **Real Impact:**

| Amount | Chunking (Route 0) | Correct Route | Loss |
|--------|-------------------|---------------|------|
| 100 APT | 4,545 USDC (Route 0) | 4,545 USDC (Route 0) | 0% ✅ |
| 500 APT | 16,667 USDC (Route 0) | 16,667 USDC (Route 0) | 0% ✅ |
| 1000 APT | 25,000 USDC (Route 0) | 25,000 USDC (Route 0) | 0% ✅ |
| 1500 APT | 30,000 USDC (Route 0) | 36,904 USDC (Route 2) | -23% ❌ |

**Chunking works for small amounts but fails for large amounts with 3+ hops!**

---

## Frontend Impact Analysis

### **Conclusion: NO Changes Required**

```
✅ Frontend code: ZERO changes
✅ Response format: SAME structure
✅ entries structure: SAME fields
✅ Usage pattern: SAME logic
```

**Why?**
- Frontend only receives **entries** (final data)
- Frontend never sees **chunks** (internal backend tool)
- Whether entries are generated with/without chunking → Frontend doesn't know and doesn't care
- Same input/output contract between frontend and backend

**Proof below:** Side-by-side code comparison shows identical frontend code.

---

### **Frontend Code - Phase 1 (with chunking):**

```typescript
// File: use-sor.ts
export const useSOR = (props: UseSORProps) => {
  const [orderBooks, setOrderBooks] = useState<OrderBook[]>([]);
  
  // Receive OrderBook from backend
  useEffect(() => {
    if (lastJsonMessage) {
      const data = lastJsonMessage.result.data as OrderBook[];
      setOrderBooks(data);  // Backend generated with chunking
    }
  }, [lastJsonMessage]);
  
  // Find closest entry
  useEffect(() => {
    const estSwapHandler = new EstSwap2Handler(
      orderBook.entries,  // Use entries (don't care how generated)
      props.amount
    );
    const result = estSwapHandler.get();
    setEstSwapResult(result);
  }, [orderBook?.entries, props.amount]);
  
  return { orderBook, estSwapResult };
};
```

```typescript
// File: est-swap-handler.ts
export class EstSwap2Handler {
  private _entries: Entry[];
  
  get(): EstSwap2Result {
    const closest = this._findClosestAmount();
    
    return {
      amounts: closest.amounts,
      routeIdx: closest.routeIdx,  // Backend already picked route
      prices: closest.prices
    };
  }
  
  private _findClosestAmount() {
    let closest = this._entries[0];
    // Find closest entry by amount
    // ...
    return closest;
  }
}
```

### **Frontend Code - Phase 2.1 (no chunking):**

```typescript
// File: use-sor.ts
export const useSOR = (props: UseSORProps) => {
  const [orderBooks, setOrderBooks] = useState<OrderBook[]>([]);
  
  // Receive OrderBook from backend
  useEffect(() => {
    if (lastJsonMessage) {
      const data = lastJsonMessage.result.data as OrderBook[];
      setOrderBooks(data);  // Backend generated WITHOUT chunking
    }
  }, [lastJsonMessage]);
  
  // Find closest entry
  useEffect(() => {
    const estSwapHandler = new EstSwap2Handler(
      orderBook.entries,  // Use entries (don't care how generated)
      props.amount
    );
    const result = estSwapHandler.get();
    setEstSwapResult(result);
  }, [orderBook?.entries, props.amount]);
  
  return { orderBook, estSwapResult };
};
```

```typescript
// File: est-swap-handler.ts
export class EstSwap2Handler {
  private _entries: Entry[];
  
  get(): EstSwap2Result {
    const closest = this._findClosestAmount();
    
    return {
      amounts: closest.amounts,
      routeIdx: closest.routeIdx,  // Backend already picked route
      prices: closest.prices
    };
  }
  
  private _findClosestAmount() {
    let closest = this._entries[0];
    // Find closest entry by amount
    // ...
    return closest;
  }
}
```

### **Comparison:**

```diff
// Phase 1 vs Phase 2.1 Frontend Code:

  export const useSOR = (props: UseSORProps) => {
    const [orderBooks, setOrderBooks] = useState<OrderBook[]>([]);
    
    useEffect(() => {
      if (lastJsonMessage) {
        const data = lastJsonMessage.result.data as OrderBook[];
-       setOrderBooks(data);  // Phase 1: entries from chunking
+       setOrderBooks(data);  // Phase 2.1: entries from full test
      }
    }, [lastJsonMessage]);
    
    useEffect(() => {
      const estSwapHandler = new EstSwap2Handler(
-       orderBook.entries,  // Phase 1: same structure
+       orderBook.entries,  // Phase 2.1: SAME structure!
        props.amount
      );
      const result = estSwapHandler.get();
      setEstSwapResult(result);
    }, [orderBook?.entries, props.amount]);
  };

// Diff: ZERO lines changed!
```

### **Why Frontend Doesn't Change:**

```javascript
// Frontend only cares about:
interface OrderBook {
  routeMatrix: RouteMatrix[][];
  entries: Entry[];  // ← This structure is SAME
  fromAddr: string;
  toAddr: string;
}

interface Entry {
  amounts: string[];    // ← SAME
  routeIdx: number;     // ← SAME
  prices: string[];     // ← SAME
  isExceed: boolean;    // ← SAME
}

// How entries were generated? Frontend doesn't know and doesn't care!
// - Phase 1: Generated with chunking (fast, less accurate)
// - Phase 2.1: Generated without chunking (slower, more accurate)
// - Frontend: Just uses entries (same structure)
```

---

## Smart Contract Impact Analysis

### **Conclusion: NO Changes Required**

```
✅ Smart contract code: ZERO changes
✅ Already supports: Unlimited hops
✅ Already supports: Multiple routes
✅ Input format: SAME (serialized bytes)
```

**Why?**
- Smart contract already handles multi-hop swaps (1, 2, 3, 4, 5+ hops)
- Chunking is backend-only optimization (never reaches smart contract)
- Frontend sends same data structure to smart contract (Phase 1 = Phase 2.1)
- Contract execution flow: unchanged

---

### **Smart Contract Design (Already Supports Phase 2):**

**File:** `tap-contract/hooks/sor/sources/entry.move`

**Function:** `execute_routes(signer: &signer, args: vector<u8>)`

**What it receives:**
```javascript
// Serialized bytes containing:
{
  route_num: u8,              // Number of routes (unused in Phase 1, ready for Phase 2.2)
  trade_type: bool,           // exact_in or exact_out
  token_path: vector<address>, // [A, B, C, D, ...] (any length!)
  amount_in: u64,
  min_amount_out: u64,
  pools: [...]                // Pool info for each hop
}
```

**Execution Loop:**
```move
// Generic loop handles ANY number of hops:
while (i < token_path.length() - 1) {
  let token_in = token_path[i];
  let token_out = token_path[i + 1];
  
  // Swap in pool (AMM, CLMM, or Stable)
  let amount_out = swap_in_pool(pool_type, token_in, token_out, amount_in);
  
  // Chain to next hop
  amount_in = amount_out;
  i += 1;
}
```

**Key Points:**
1. **No hop limit:** Loop continues for `token_path.length - 1` iterations
2. **No route limit:** `route_num` field already exists (Phase 2.2 ready)
3. **No code changes:** Same logic works for 1 hop, 2 hops, 5 hops, etc.

---

### **Example: Smart Contract receives SAME input format**

#### **Phase 1 (2 hops):**

```javascript
// Frontend sends:
serialized_bytes = [
  0x01,           // route_num = 1
  0x01,           // trade_type = exact_in
  0x03,           // token_path length = 3 (APT, WETH, USDC)
  ...APT_addr,    // token_path[0]
  ...WETH_addr,   // token_path[1]
  ...USDC_addr,   // token_path[2]
  ...amount_in,
  ...min_out,
  0x03, ...pool_apt_weth,   // Pool 1: CLMM
  0x02, ...pool_weth_usdc   // Pool 2: AMM
]

// Smart contract executes:
// Loop: i=0,1 (2 iterations)
// Hop 1: APT → WETH
// Hop 2: WETH → USDC
```

#### **Phase 2.1 (5 hops):**

```javascript
// Frontend sends:
serialized_bytes = [
  0x01,           // route_num = 1 (same!)
  0x01,           // trade_type = exact_in (same!)
  0x06,           // token_path length = 6 (APT, A, B, C, D, USDC)
  ...APT_addr,    // token_path[0]
  ...A_addr,      // token_path[1]
  ...B_addr,      // token_path[2]
  ...C_addr,      // token_path[3]
  ...D_addr,      // token_path[4]
  ...USDC_addr,   // token_path[5]
  ...amount_in,   // (same field!)
  ...min_out,     // (same field!)
  0x02, ...pool_apt_a,   // Pool 1
  0x03, ...pool_a_b,     // Pool 2
  0x02, ...pool_b_c,     // Pool 3
  0x04, ...pool_c_d,     // Pool 4
  0x02, ...pool_d_usdc   // Pool 5
]

// Smart contract executes:
// Loop: i=0,1,2,3,4 (5 iterations) ← Same loop logic!
// Hop 1: APT → A
// Hop 2: A → B
// Hop 3: B → C
// Hop 4: C → D
// Hop 5: D → USDC
```

**Difference:** Only `token_path.length` and number of pools  
**Contract code:** Exactly the same!

---

### **Why Smart Contract Already Supports This:**

```javascript
// Smart contract was designed to be GENERIC from day 1:

// ❌ BAD design (would need changes):
function execute_2_hop_swap() { ... }  // Hard-coded 2 hops

// ✅ GOOD design (Phase 2 ready):
function execute_routes(token_path: vector) {
  // Loop based on token_path.length
  // Works for ANY number of hops
}
```

**The only changes between Phase 1 and Phase 2.1:**
- Backend: How entries are generated (chunking vs no chunking)
- Frontend: None (same code)
- Smart Contract: None (same code)

---

## Summary

### **Key Points:**

#### **1. What is Chunking?**
- Backend optimization to generate entries faster
- Tests subset of amounts, applies to nearby amounts
- Assumes: "nearby amounts use same route"

#### **2. Chunking vs Entries:**
- **Chunking** = Internal backend tool (never sent to frontend)
- **Entries** = Final OrderBook data (always sent to frontend)
- **Relationship**: Chunking is HOW entries are generated (one method)

#### **3. Why Remove in Phase 2?**
- ❌ Assumption breaks with 3+ hops
- ❌ Routes change frequently for nearby amounts
- ❌ Gives WRONG results (worse than no optimization)
- ✅ Better to test all amounts (more accurate)

#### **4. Frontend Impact:**
- ✅ **ZERO changes needed!**
- Same response format: `{ routeMatrix, entries }`
- Same code: find closest entry → get routeIdx → execute
- Frontend doesn't know (and doesn't care) how entries were generated

#### **5. Smart Contract Impact:**
- ✅ **ZERO changes needed!**
- Already supports unlimited hops (generic loop design)
- Input format: Same serialized bytes structure
- Execution flow: Unchanged (loop based on token_path.length)

---

## Conclusion

```
Chunking removal in Phase 2 is:
  ✅ Necessary (chunking gives wrong results for 3+ hops)
  ✅ Beneficial (better output quality)
  ✅ Safe (frontend & smart contract unchanged)

Impact by layer:
  Backend: Remove chunking logic, test all amounts
  Frontend: No action needed!
  Smart Contract: No action needed!
```

---

**Document Version:** 1.0  
**Last Updated:** October 28, 2025  

