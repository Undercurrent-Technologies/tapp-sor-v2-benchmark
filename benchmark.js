#!/usr/bin/env node

/**
 * Benchmark: Phase 1 (DFS) vs Phase 2 (Yen's K-Shortest Paths)
 * 
 * Runs both algorithms with SAME input and compares:
 * 1. Execution time
 * 2. Number of routes found
 * 3. Output amount (which gives better result)
 * 4. Memory usage
 * 
 * Usage:
 *   node benchmark.js APT USDC 10000
 *   node benchmark.js APT USDT 10000 --max-hops=3
 */

const { Client } = require('pg');
const phase1 = require('./phase1-dfs-poc');
const phase2Module = require('./yens-algorithm-poc');

// ============================================================================
// Configuration
// ============================================================================

const dbConfig = {
  host: 'localhost',
  port: 5432,
  database: 'tapp',
  user: 'tapp',
  password: 'tapp',
};

// Command-line arguments
const args = process.argv.slice(2);
const tokenFrom = args[0] || 'APT';
const tokenTo = args[1] || 'USDC';
const swapAmount = parseFloat(args[2] || '10000');
const maxHopsPhase1 = 2; // Phase 1 always uses 2 hops
const maxHopsPhase2 = parseInt(args.find(a => a.startsWith('--max-hops='))?.split('=')[1] || '3');
const K = parseInt(args.find(a => a.startsWith('--k='))?.split('=')[1] || '5');

// ============================================================================
// Benchmark Runner
// ============================================================================

async function runBenchmark() {
  console.log('='.repeat(80));
  console.log('📊 BENCHMARK: PHASE 1 (DFS) vs PHASE 2 (YEN\'S ALGORITHM)');
  console.log('='.repeat(80));
  console.log();
  console.log(`Test Configuration:`);
  console.log(`  Token Pair: ${tokenFrom} → ${tokenTo}`);
  console.log(`  Amount: ${swapAmount}`);
  console.log(`  Phase 1 Max Hops: ${maxHopsPhase1}`);
  console.log(`  Phase 2 Max Hops: ${maxHopsPhase2}`);
  console.log(`  Phase 2 K: ${K}`);
  console.log();
  console.log('='.repeat(80));
  console.log();
  
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    
    // Fetch data once (shared between both tests)
    console.log('📡 Fetching pool data...');
    const poolsQuery = `
      SELECT 
        p.addr as pool_addr,
        p.pool_type,
        p.fee_tier,
        p.liquidity,
        p.sqrt_price,
        json_agg(
          json_build_object(
            'addr', t.addr,
            'symbol', t.ticker,
            'decimals', t.decimals,
            'reserve', ptm.reserve,
            'token_idx', ptm.token_idx
          ) ORDER BY ptm.token_idx
        ) as tokens
      FROM pools p
      JOIN pool_token_mps ptm ON p.addr = ptm.pool_id
      JOIN tokens t ON ptm.token_addr = t.addr
      WHERE p.status = 'ACTIVE'
        AND p.liquidity > 0
      GROUP BY p.addr, p.pool_type, p.fee_tier, p.liquidity, p.sqrt_price
      ORDER BY p.liquidity DESC
    `;
    
    const poolsResult = await client.query(poolsQuery);
    const pools = poolsResult.rows;
    
    const tokensQuery = `SELECT addr, ticker as symbol, decimals FROM tokens`;
    const tokensResult = await client.query(tokensQuery);
    const tokenMap = new Map();
    for (const row of tokensResult.rows) {
      tokenMap.set(row.addr, row);
    }
    
    console.log(`✅ Loaded ${pools.length} pools, ${tokenMap.size} tokens\n`);
    
    const sourceToken = Array.from(tokenMap.values()).find(t => t.symbol === tokenFrom);
    const targetToken = Array.from(tokenMap.values()).find(t => t.symbol === tokenTo);
    
    if (!sourceToken || !targetToken) {
      console.log('❌ Token not found!\n');
      return;
    }
    
    console.log('='.repeat(80));
    console.log();
    
    // ========================================================================
    // Run Phase 1 (DFS)
    // ========================================================================
    
    console.log('🔵 PHASE 1: DFS Algorithm (Current Implementation)');
    console.log('-'.repeat(80));
    
    const phase1StartMem = process.memoryUsage();
    const phase1Start = Date.now();
    
    // DFS to find ALL routes
    const allRoutes = phase1.findAllRoutesDFS(
      pools.map(p => new PoolWrapper(p)),
      sourceToken.addr,
      targetToken.addr,
      maxHopsPhase1
    );
    
    const phase1DfsTime = Date.now() - phase1Start;
    
    // Select best route
    const phase1EvalStart = Date.now();
    const phase1BestResult = phase1.selectBestRoute(allRoutes, swapAmount);
    const phase1EvalTime = Date.now() - phase1EvalStart;
    
    const phase1TotalTime = Date.now() - phase1Start;
    const phase1EndMem = process.memoryUsage();
    const phase1MemUsed = (phase1EndMem.heapUsed - phase1StartMem.heapUsed) / 1024 / 1024;
    
    console.log();
    console.log(`Results:`);
    console.log(`  Routes found: ${allRoutes.length}`);
    console.log(`  Best output: ${phase1BestResult.output.toFixed(2)}`);
    console.log();
    console.log(`Performance:`);
    console.log(`  DFS time: ${phase1DfsTime}ms`);
    console.log(`  Evaluation time: ${phase1EvalTime}ms`);
    console.log(`  Total time: ${phase1TotalTime}ms`);
    console.log(`  Memory used: ${phase1MemUsed.toFixed(2)} MB`);
    console.log();
    console.log('='.repeat(80));
    console.log();
    
    // ========================================================================
    // Run Phase 2 (Yen's)
    // ========================================================================
    
    console.log('🟢 PHASE 2: YEN\'S K-SHORTEST PATHS Algorithm (New)');
    console.log('-'.repeat(80));
    
    const phase2StartMem = process.memoryUsage();
    const phase2Start = Date.now();
    
    // Build graph
    const graphBuildStart = Date.now();
    const graph = phase2Module.buildLiquidityGraph(pools);
    const graphBuildTime = Date.now() - graphBuildStart;
    
    // Find K best routes
    const yensStart = Date.now();
    const kRoutes = phase2Module.findKShortestPaths(
      graph,
      sourceToken.addr,
      targetToken.addr,
      K,
      maxHopsPhase2
    );
    const yensTime = Date.now() - yensStart;
    
    // Evaluate best single route (for fair comparison with Phase 1)
    let phase2BestOutput = 0;
    let phase2BestRoute = null;
    
    if (kRoutes.length > 0) {
      for (const route of kRoutes) {
        let currentAmount = swapAmount;
        for (const edge of route.path) {
          const { pool } = edge;
          const { tokenA, tokenB, fee } = pool;
          
          const reserveA = parseFloat(tokenA.reserve);
          const reserveB = parseFloat(tokenB.reserve);
          
          if (reserveA === 0 || reserveB === 0) {
            currentAmount = 0;
            break;
          }
          
          const isReversed = pool.reversed;
          const [reserveIn, reserveOut] = isReversed
            ? [reserveB, reserveA]
            : [reserveA, reserveB];
          
          const amountInAfterFee = currentAmount * (1 - fee);
          currentAmount = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
        }
        
        if (currentAmount > phase2BestOutput) {
          phase2BestOutput = currentAmount;
          phase2BestRoute = route;
        }
      }
    }
    
    // Route splitting (Phase 2.2)
    const splittingStart = Date.now();
    const splitResult = kRoutes.length > 0
      ? phase2Module.optimizeRouteSplitting(graph, kRoutes, swapAmount, 5)
      : { totalOutput: 0, allocation: [] };
    const splittingTime = Date.now() - splittingStart;
    
    const phase2TotalTime = Date.now() - phase2Start;
    const phase2EndMem = process.memoryUsage();
    const phase2MemUsed = (phase2EndMem.heapUsed - phase2StartMem.heapUsed) / 1024 / 1024;
    
    console.log();
    console.log(`Results:`);
    console.log(`  Routes found (K): ${kRoutes.length}`);
    console.log(`  Best single route output: ${phase2BestOutput.toFixed(2)}`);
    console.log(`  Route splitting output: ${splitResult.totalOutput.toFixed(2)}`);
    console.log(`  Split allocation: ${splitResult.allocation.length} routes`);
    console.log();
    console.log(`Performance:`);
    console.log(`  Graph build time: ${graphBuildTime}ms`);
    console.log(`  Yen's algorithm time: ${yensTime}ms`);
    console.log(`  Route splitting time: ${splittingTime}ms`);
    console.log(`  Total time: ${phase2TotalTime}ms`);
    console.log(`  Memory used: ${phase2MemUsed.toFixed(2)} MB`);
    console.log();
    console.log('='.repeat(80));
    console.log();
    
    // ========================================================================
    // Comparison
    // ========================================================================
    
    console.log('📊 COMPARISON SUMMARY');
    console.log('='.repeat(80));
    console.log();
    
    const speedup = ((phase1TotalTime - phase2TotalTime) / phase1TotalTime * 100);
    const phase2Improvement = ((phase2BestOutput - phase1BestResult.output) / phase1BestResult.output * 100);
    const phase22Improvement = ((splitResult.totalOutput - phase1BestResult.output) / phase1BestResult.output * 100);
    
    console.log('| Metric                    | Phase 1 (DFS)  | Phase 2.1 (Yen) | Phase 2.2 (Split) | Winner    |');
    console.log('|---------------------------|----------------|-----------------|-------------------|-----------|');
    console.log(`| Routes Found              | ${String(allRoutes.length).padEnd(14)} | ${String(kRoutes.length).padEnd(15)} | ${String(kRoutes.length).padEnd(17)} | ${kRoutes.length < allRoutes.length ? 'Phase 2 ✅' : 'Phase 1'} |`);
    console.log(`| Best Output               | ${phase1BestResult.output.toFixed(2).padEnd(14)} | ${phase2BestOutput.toFixed(2).padEnd(15)} | ${splitResult.totalOutput.toFixed(2).padEnd(17)} | ${splitResult.totalOutput > phase1BestResult.output ? 'Phase 2.2 ✅' : 'Phase 1'} |`);
    console.log(`| Execution Time (ms)       | ${String(phase1TotalTime).padEnd(14)} | ${String(phase2TotalTime).padEnd(15)} | ${String(phase2TotalTime).padEnd(17)} | ${phase2TotalTime < phase1TotalTime ? 'Phase 2 ✅' : 'Phase 1'} |`);
    console.log(`| Memory Used (MB)          | ${phase1MemUsed.toFixed(2).padEnd(14)} | ${phase2MemUsed.toFixed(2).padEnd(15)} | ${phase2MemUsed.toFixed(2).padEnd(17)} | ${phase2MemUsed < phase1MemUsed ? 'Phase 2 ✅' : 'Phase 1'} |`);
    console.log();
    
    console.log('Key Improvements:');
    console.log(`  🚀 Speed: Phase 2 is ${speedup > 0 ? speedup.toFixed(1) : Math.abs(speedup).toFixed(1)}% ${speedup > 0 ? 'faster' : 'slower'}`);
    console.log(`  💰 Output (Phase 2.1): ${phase2Improvement > 0 ? '+' : ''}${phase2Improvement.toFixed(2)}% vs Phase 1`);
    console.log(`  💰 Output (Phase 2.2 with splitting): ${phase22Improvement > 0 ? '+' : ''}${phase22Improvement.toFixed(2)}% vs Phase 1`);
    console.log(`  📉 Routes: ${((1 - kRoutes.length / allRoutes.length) * 100).toFixed(1)}% fewer routes to evaluate`);
    console.log();
    
    if (speedup > 0 && phase22Improvement > 0) {
      console.log('🎉 VERDICT: Phase 2 is BETTER (faster AND better output)!');
    } else if (speedup > 0) {
      console.log('✅ VERDICT: Phase 2 is faster but similar output');
    } else if (phase22Improvement > 0) {
      console.log('✅ VERDICT: Phase 2 has better output but slower');
    } else {
      console.log('⚠️  VERDICT: Mixed results - need optimization');
    }
    console.log();
    
    // ========================================================================
    // Detailed Breakdown
    // ========================================================================
    
    console.log('='.repeat(80));
    console.log('📋 DETAILED BREAKDOWN');
    console.log('='.repeat(80));
    console.log();
    
    console.log('Phase 1 Time Breakdown:');
    console.log(`  DFS (find all routes):    ${phase1DfsTime}ms (${(phase1DfsTime / phase1TotalTime * 100).toFixed(1)}%)`);
    console.log(`  Evaluation (best route):  ${phase1EvalTime}ms (${(phase1EvalTime / phase1TotalTime * 100).toFixed(1)}%)`);
    console.log(`  Total:                    ${phase1TotalTime}ms`);
    console.log();
    
    console.log('Phase 2 Time Breakdown:');
    console.log(`  Graph build:              ${graphBuildTime}ms (${(graphBuildTime / phase2TotalTime * 100).toFixed(1)}%)`);
    console.log(`  Yen's algorithm:          ${yensTime}ms (${(yensTime / phase2TotalTime * 100).toFixed(1)}%)`);
    console.log(`  Route splitting:          ${splittingTime}ms (${(splittingTime / phase2TotalTime * 100).toFixed(1)}%)`);
    console.log(`  Total:                    ${phase2TotalTime}ms`);
    console.log();
    
    console.log('Scalability Analysis:');
    console.log(`  Phase 1: O(pools^hops) = O(${pools.length}^${maxHopsPhase1}) ≈ ${Math.pow(pools.length, maxHopsPhase1).toLocaleString()} combinations`);
    console.log(`  Phase 2: O(K × V × E) = O(${K} × ${graph.nodes.size} × ${graph.edges.length / 2}) ≈ ${(K * graph.nodes.size * graph.edges.length / 2).toLocaleString()} operations`);
    console.log();
    
    if (maxHopsPhase2 > 2) {
      const phase1Extrapolated = Math.pow(pools.length, maxHopsPhase2);
      console.log(`  ⚠️  If Phase 1 used ${maxHopsPhase2} hops:`);
      console.log(`      Estimated routes: ${phase1Extrapolated.toLocaleString()}`);
      console.log(`      Estimated time: ${(phase1DfsTime * (phase1Extrapolated / allRoutes.length)).toFixed(0)}ms`);
      console.log(`      → Phase 1 would be TOO SLOW! ❌`);
      console.log();
    }
    
    console.log('✅ Benchmark completed!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Fix module reference
class PoolWrapper {
  constructor(data) {
    this.addr = data.pool_addr;
    this.type = data.pool_type;
    this.fee = parseFloat(data.fee_tier);
    this.liquidity = data.liquidity;
    this.tokens = data.tokens || [];
  }
  
  hasToken(tokenAddr) {
    return this.tokens.some(t => t.addr === tokenAddr);
  }
  
  getOtherToken(tokenAddr) {
    return this.tokens.find(t => t.addr !== tokenAddr);
  }
}

// Run
if (require.main === module) {
  runBenchmark();
}

module.exports = { runBenchmark };

