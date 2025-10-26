# SOR Phase 2 POC - Yen's K-Shortest Paths Algorithm

Proof of Concept implementation for Smart Order Routing Phase 2 using real pool data from PostgreSQL database.

---

## 🎯 What This POC Does

1. **Fetches real pool data** from TAPP PostgreSQL database
2. **Builds liquidity graph** from pools (tokens = nodes, pools = edges)
3. **Implements Dijkstra's algorithm** to find shortest paths
4. **Implements Yen's K-Shortest Paths** to find top K alternative routes
5. **Optimizes route splitting** using marginal analysis
6. **Compares Phase 1 vs Phase 2** performance

---

## 📦 Prerequisites

### 1. Setup Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` if needed (default values are fine for local development).

### 2. Start PostgreSQL Database

The database will automatically restore from `backup/cloud-db.sql` on first initialization:

```bash
docker-compose up -d db
```

Verify the database is running:

```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs -f db

# Test connection
docker-compose exec db psql -U tapp -d tapp -c "SELECT COUNT(*) FROM pools;"
```

**Connection Info:**
- Host: localhost
- Port: 5433
- Database: tapp
- User: tapp
- Password: tapp

> **Note**: Port 5433 is used to avoid conflict with local PostgreSQL on port 5432. Edit `.env` to change the port if needed.

### 3. Install Dependencies

```bash
npm install
```

---

### Troubleshooting Database

**Reset database (⚠️ deletes all data):**

```bash
docker-compose down -v
docker-compose up -d db
```

**Manually restore database:**

```bash
docker cp ./backup/cloud-db.sql tapp-postgres:/tmp/cloud-db.sql
docker-compose exec db psql -U tapp -d tapp -f /tmp/cloud-db.sql
docker-compose exec db rm /tmp/cloud-db.sql
```

---

## 🚀 Quick Start Guide

### Option 1: Run Benchmark (Compare All Algorithms)

Compare Phase 1 DFS vs Phase 2 (Yen's Algorithm):

```bash
# Benchmark with multi-hop example (recommended)
node benchmark.js DOGE BTC 10000 --max-hops=3 --skip-astar

# Benchmark with stablecoins (direct pools)
node benchmark.js USDC USDT 10000 --max-hops=3 --skip-astar

# With custom K and max-hops
node benchmark.js DOGE BTC 10000 --max-hops=4 --k=10 --skip-astar
```

**Expected**: Shows detailed comparison table with:
- Routes found (Phase 1 explores all, Phase 2 explores top K)
- Best output amount
- Execution time (Phase 2 is typically 50-75% faster)
- Memory usage
- Winner for each metric

---

### Option 2: Run Phase 1 (Current DFS Algorithm)

Test the current implementation:

```bash
# Run Phase 1 (DFS, max 3 hops)
node phase1-dfs-poc.js DOGE BTC 10000 --max-hops=3

# With verbose output
node phase1-dfs-poc.js DOGE BTC 10000 --max-hops=3 --verbose
```

**Expected**: Finds all routes (exhaustive search), picks best single route.

---

### Option 3: Run Phase 2 (Yen's Algorithm)

Test the new implementation with 3-5 hops:

```bash
# Run Phase 2 (Yen's, max 5 hops, K=5 routes)
node yens-algorithm-poc.js APT USDC 10000 --k=5 --max-hops=5

# With verbose output
node yens-algorithm-poc.js APT USDC 10000 --k=5 --max-hops=5 --verbose

# Large order test (see route splitting benefit)
node yens-algorithm-poc.js APT USDC 100000 --k=5
```

**Expected**: Finds top K routes intelligently, optimizes splitting across routes.

---

### Option 4: Analyze Database

Check available token pairs in the database:

```bash
node check-tokens.js
```

This shows:
- Top tokens with most pools
- Token pairs with direct pools
- Suggested pairs for benchmarking

---

### Option 5: Test Phase 1 Scalability Limits

Demonstrate why Phase 1 cannot handle 3+ hops:

```bash
# Test Phase 1 with 2 hops vs 3 hops
node test-phase1-limits.js
```

**Expected**: Shows Phase 1 timeout at 3 hops for well-connected tokens (APT, USDC, ETH).

---

### Parameters Reference

- **tokenFrom**: Source token symbol (e.g., `APT`, `USDC`, `WETH`)
- **tokenTo**: Destination token symbol
- **amount**: Amount to swap (in token units, not accounting for decimals)
- **--k=N**: Number of routes to find (Phase 2 only, default: 5)
- **--max-hops=N**: Maximum hops per route (default: Phase 1=2, Phase 2=5)
- **--verbose**: Show detailed logs for debugging

---

## 📊 Benchmark Summary

After running `node benchmark.js APT USDC 10000`, you'll see a comparison table:

### Performance Comparison Table

| Metric | Phase 1 (DFS) | Phase 2.1 (Yen) | Phase 2.2 (Split) | Winner |
|--------|---------------|-----------------|-------------------|--------|
| **Routes Found** | 50-100 (all) | 5-10 (top K) | 5-10 (top K) | Phase 2 ✅ |
| **Best Output** | 4,950 USDC | 5,976 USDC | 7,235 USDC | Phase 2.2 ✅ |
| **Execution Time (2 hops)** | 1-27ms | 1-4ms | 1-4ms | Similar |
| **Execution Time (3 hops)** | ~27 minutes ❌ | <1ms ✅ | <1ms ✅ | **Phase 2 ONLY!** |
| **Memory Used** | 0.24-1.30 MB | 0.25-0.34 MB | 0.25-0.34 MB | Phase 2 ✅ |
| **Output Improvement** | Baseline | +20.7% | +46.2% | Phase 2.2 ✅ |

### Key Findings

✅ **For 2 hops**: Phase 1 slightly faster for simple cases (~1-3ms difference)  
✅ **For 3+ hops**: Phase 2 is **MANDATORY** (Phase 1 takes 27 minutes, Phase 2 takes <1ms)  
✅ **Route splitting**: Up to +180% better output for large orders  
✅ **Memory**: Phase 2 uses ~50% less memory

**Bottom Line**: Phase 2 enables 3+ hops (impossible with Phase 1) with minimal overhead for 2 hops cases.

**See full benchmark results**: [BENCHMARK-RESULTS.md](./BENCHMARK-RESULTS.md)

---

## 🏗️ Algorithm Overview

**Implementation File**: `yens-algorithm-poc.js`

| Component | Description |
|-----------|-------------|
| **Graph Builder** | Converts pools → weighted graph (tokens=nodes, pools=edges) |
| **Dijkstra's Algorithm** | Finds shortest path using priority queue |
| **Yen's K-Shortest Paths** | Finds top K alternative routes by deviation |
| **Route Splitting** | Optimizes amount distribution via marginal analysis |

**See code**: [`yens-algorithm-poc.js`](./yens-algorithm-poc.js) for complete implementation

---

## 🧪 Testing Different Scenarios

```bash
# Small order (minimal benefit expected)
node yens-algorithm-poc.js APT USDC 100

# Medium order (some benefit)
node yens-algorithm-poc.js APT USDC 10000

# Large order (significant route splitting benefit)
node yens-algorithm-poc.js APT USDC 100000 --k=5

# Test different hop limits
node yens-algorithm-poc.js APT USDC 10000 --max-hops=2  # Phase 1 style
node yens-algorithm-poc.js APT USDC 10000 --max-hops=5  # Phase 2 style

# Test scalability limits (Phase 1 will timeout!)
node test-phase1-limits.js
```

**Expected Results**:
- Small orders: Minimal improvement (< 5%)
- Large orders: Significant improvement (20-180%+)
- More hops: Better routes, better splitting

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| "No pools found in database!" | Restore database from backup or seed data |
| "Connection refused" | Check PostgreSQL: `docker-compose ps db` |
| "Token X not found" | Run with `--verbose` to see available tokens |
| Poor performance (> 5s) | Reduce K (`--k=3`) or maxHops (`--max-hops=3`) |

---

## 📚 Additional Documentation

### Why Not Hybrid Approach?

**Question**: Since Phase 1 is faster for 2 hops (~1-3ms difference), why not use Phase 1 for 2 hops and Phase 2 for 3+ hops?

**Answer**: NOT recommended!

**Reasoning**:
- **Gain**: Only ~3ms for simple cases (1ms vs 4ms)
- **Cost**: 2× code complexity, 2× testing effort, technical debt
- **Impact**: 3ms is only 6% of 50ms budget (negligible)
- **Limitation**: Cannot use route splitting for 2 hops with Phase 1
- **Verdict**: Simpler to use Pure Phase 2 for all cases

**Decision**: Use Pure Phase 2 for simplicity and consistency.

**See full analysis**: [HYBRID-APPROACH-ANALYSIS.md](./HYBRID-APPROACH-ANALYSIS.md)

---

### Additional Documentation Links

📊 **[BENCHMARK-RESULTS.md](./BENCHMARK-RESULTS.md)** - Complete benchmark results  
- Phase 1 vs Phase 2 performance comparison
- Real-world scalability analysis (why 3+ hops fail in Phase 1)
- Memory usage comparison
- Output quality improvements

🧪 **[TEST-RESULTS.md](./TEST-RESULTS.md)** - Algorithm validation  
- Database stats (176 pools, 50 tokens from production)
- Algorithm correctness validation
- Expected production impact
- Next steps for Rust implementation

---

**POC Status**: ✅ **VALIDATED with real production data!**  
**Last Updated**: 2025-10-24  
**Maintainer**: TAPP Backend Team

