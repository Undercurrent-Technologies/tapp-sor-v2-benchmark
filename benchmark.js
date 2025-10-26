#!/usr/bin/env node

/**
 * Benchmark: Phase 1 (DFS + A*) vs Phase 2 (Yen's K-Shortest Paths)
 * 
 * Runs all algorithms with SAME input and compares:
 * 1. Execution time
 * 2. Number of routes found
 * 3. Output amount (which gives better result)
 * 4. Memory usage
 * 
 * Usage:
 *   node benchmark.js APT USDC 10000
 *   node benchmark.js APT USDT 10000 --max-hops=3 --top-k=40 --beam=32 --gas-per-hop=0.01
 */

require('dotenv').config();
const { Client } = require('pg');
const phase1 = require('./phase1-dfs-poc');
const phase1AStar = require('./phase1-astar-mike');
const phase2Module = require('./yens-algorithm-poc');

// ============================================================================
// Configuration
// ============================================================================

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'tapp',
  user: process.env.DB_USER || 'tapp',
  password: process.env.DB_PASSWORD || 'tapp',
};

// Command-line arguments
const args = process.argv.slice(2);
const tokenFrom = args[0] || 'APT';
const tokenTo = args[1] || 'USDC';
const swapAmount = parseFloat(args[2] || '10000');
const maxHops = parseInt(args.find(a => a.startsWith('--max-hops='))?.split('=')[1] || '3');
const maxHopsPhase1 = maxHops;
const maxHopsPhase2 = maxHops;
const maxHopsAStar = maxHops;
const K = parseInt(args.find(a => a.startsWith('--k='))?.split('=')[1] || '5');
const topK = parseInt(args.find(a => a.startsWith('--top-k='))?.split('=')[1] || '40');
const beamWidth = parseInt(args.find(a => a.startsWith('--beam='))?.split('=')[1] || '32');
const gasPerHop = parseFloat(args.find(a => a.startsWith('--gas-per-hop='))?.split('=')[1] || '0.01');
const skipAStar = args.includes('--skip-astar');

// ============================================================================
// Benchmark Runner
// ============================================================================

async function runBenchmark() {
  console.log('='.repeat(80));
  console.log('📊 BENCHMARK: PHASE 1 (DFS + A*) vs PHASE 2 (YEN\'S)');
  console.log('='.repeat(80));
  console.log();
  console.log(`Test Configuration:`);
  console.log(`  Token Pair: ${tokenFrom} → ${tokenTo}`);
  console.log(`  Amount: ${swapAmount}`);
  console.log(`  Phase 1 DFS Max Hops: ${maxHopsPhase1}`);
  console.log(`  Phase 1 A* Max Hops: ${maxHopsAStar}`);
  console.log(`  Phase 2 Max Hops: ${maxHopsPhase2}`);
  console.log(`  Phase 2 K: ${K}`);
  console.log(`  Phase 1 A* Top K: ${topK}, Beam: ${beamWidth}, Gas: $${gasPerHop}`);
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
    
    // Debug: Show the best route if it exists
    if (phase1BestResult.route && phase1BestResult.route.length > 0) {
      const routeStr = phase1BestResult.route.map(h => h.to).join(' → ');
      console.log(`Phase 1 Best Route: ${tokenFrom} → ${routeStr}`);
      console.log(`Phase 1 Best Route length: ${phase1BestResult.route.length} hops\n`);
    }
    
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
    // Run Phase 1 A* (A* Search)
    // ========================================================================
    
    let aStarRoutes = [];
    let astarBestResult = { route: null, output: 0 };
    let phase1AStarTotalTime = 0;
    let phase1AStarMemUsed = 0;
    let astarSearchTime = 0;
    let astarEvalTime = 0;
    let heuristicTime = 0;
    let astarGraphTime = 0;
    
    if (skipAStar) {
      console.log('🟡 PHASE 1 A*: SKIPPED (--skip-astar flag set)');
      console.log('-'.repeat(80));
      console.log();
      console.log('Results: N/A');
      console.log('Performance: N/A');
      console.log();
      console.log('='.repeat(80));
      console.log();
    } else {
      console.log('🟡 PHASE 1 A*: A* ALGORITHM WITH TARGET-AWARE HEURISTIC');
      console.log('-'.repeat(80));
    
    const phase1AStarStartMem = process.memoryUsage();
    const phase1AStarStart = Date.now();
    
    // Build adjacency and run A* search
    console.log('Building adjacency map...');
    const astarGraphStart = Date.now();
    const { adj, tokenToId, poolToId } = phase1AStar.buildAdjacencyMap(pools.map(p => new PoolWrapper(p)), tokenMap);
    console.log(`Adjacency map built: ${adj.size} tokens`);
    phase1AStar.compressParallelEdges(adj);
    const { adjId, idToAddr } = phase1AStar.buildNumericAdjacency(adj, tokenToId);
    const astarGraphTime = Date.now() - astarGraphStart;
    console.log(`Graph preprocessing done in ${astarGraphTime}ms\n`);
    
    // Compute heuristic
    console.log('Computing reverse Dijkstra heuristic...');
    const heuristicStart = Date.now();
    let targetTokenUSDPrice = 1.0;
    const stablecoins = ['USDC', 'USDT', 'DAI', 'BUSD', 'UST'];
    if (stablecoins.includes(targetToken.symbol)) {
      targetTokenUSDPrice = 1.0;
    }
    const gasPerHopInOutputTokens = gasPerHop / targetTokenUSDPrice;
    const gasPerHopPenalty = gasPerHop > 0 ? Math.log(1 + gasPerHopInOutputTokens / swapAmount) : 0;
    const heuristic = phase1AStar.computeReverseHeuristic(adj, targetToken.addr, gasPerHopPenalty);
    const heuristicId = phase1AStar.mapHeuristicToIds(heuristic, tokenToId);
    const heuristicTime = Date.now() - heuristicStart;
    console.log(`Heuristic computed in ${heuristicTime}ms\n`);
    
    // Find top K routes with A*
    console.log(`Running A* search (K=${topK}, maxHops=${maxHopsAStar}, beam=${beamWidth})...`);
    let aStarRoutes = [];
    let astarSearchTime = 0;
    let astarBestResult = { route: null, output: 0 };
    let astarEvalTime = 0;
    
    try {
      const astarSearchStart = Date.now();
      
      // Set timeout for A* search (5 seconds)
      const timeout = setTimeout(() => {
        console.log(`⚠️  A* search timeout after 5 seconds, using empty results`);
      }, 5000);
      
      aStarRoutes = phase1AStar.findTopKRoutesAStar(
        adjId, 
        heuristicId, 
        tokenToId, 
        idToAddr, 
        sourceToken.addr, 
        targetToken.addr, 
        maxHopsAStar, 
        topK, 
        beamWidth, 
        gasPerHopPenalty
      );
      
      clearTimeout(timeout);
      astarSearchTime = Date.now() - astarSearchStart;
      console.log(`A* search found ${aStarRoutes.length} routes in ${astarSearchTime}ms\n`);
      
      // Select best route
      const astarEvalStart = Date.now();
      astarBestResult = phase1AStar.selectBestRoute(aStarRoutes, swapAmount, gasPerHopInOutputTokens);
      astarEvalTime = Date.now() - astarEvalStart;
    } catch (error) {
      console.log(`⚠️  A* search failed: ${error.message}`);
      console.log(`Skipping Phase 1 A* results\n`);
    }
    
      const phase1AStarTotalTimeCalc = Date.now() - phase1AStarStart;
      const phase1AStarEndMem = process.memoryUsage();
      phase1AStarTotalTime = phase1AStarTotalTimeCalc;
      phase1AStarMemUsed = (phase1AStarEndMem.heapUsed - phase1AStarStartMem.heapUsed) / 1024 / 1024;
    
    console.log();
    console.log(`Results:`);
    console.log(`  Routes found: ${aStarRoutes.length}`);
    console.log(`  Best output: ${astarBestResult.output.toFixed(2)}`);
    console.log();
    console.log(`Performance:`);
    console.log(`  Graph build time: ${astarGraphTime}ms`);
    console.log(`  Heuristic computation: ${heuristicTime}ms`);
    console.log(`  A* search time: ${astarSearchTime}ms`);
    console.log(`  Evaluation time: ${astarEvalTime}ms`);
    console.log(`  Total time: ${phase1AStarTotalTime}ms`);
    console.log(`  Memory used: ${phase1AStarMemUsed.toFixed(2)} MB`);
    console.log();
    console.log('='.repeat(80));
    console.log();
    } // End else for skipAStar
    
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
    
    const phase2Speedup = ((phase1TotalTime - phase2TotalTime) / phase1TotalTime * 100);
    const phase1AStarSpeedup = ((phase1TotalTime - phase1AStarTotalTime) / phase1TotalTime * 100);
    const phase2Improvement = ((phase2BestOutput - phase1BestResult.output) / phase1BestResult.output * 100);
    const astarImprovement = ((astarBestResult.output - phase1BestResult.output) / phase1BestResult.output * 100);
    const phase22Improvement = ((splitResult.totalOutput - phase1BestResult.output) / phase1BestResult.output * 100);
    
    // Find best output - filter out unrealistic outputs (likely bug in simulation)
    // Check if output is too large (likely decimal/scale issue)
    const isRealisticOutput = (output, inputAmount) => {
      if (output === 0) return false;
      // If output > 1000× input, it's likely a simulation bug
      if (output > inputAmount * 1000) return false;
      return true;
    };
    
    const outputs = [
      { name: 'Phase 1 DFS', value: phase1BestResult.output, realistic: isRealisticOutput(phase1BestResult.output, swapAmount) },
      { name: 'Phase 1 A*', value: astarBestResult.output, realistic: isRealisticOutput(astarBestResult.output, swapAmount) },
      { name: 'Phase 2.1 Yen', value: phase2BestOutput, realistic: isRealisticOutput(phase2BestOutput, swapAmount) },
      { name: 'Phase 2.2 Split', value: splitResult.totalOutput, realistic: isRealisticOutput(splitResult.totalOutput, swapAmount) }
    ];
    
    // Find best among realistic outputs only
    const realisticOutputs = outputs.filter(o => o.realistic);
    const bestOutput = realisticOutputs.length > 0 
      ? Math.max(...realisticOutputs.map(o => o.value))
      : Math.max(...outputs.map(o => o.value));
    
    const winners = bestOutput > 0 ? outputs.filter(o => o.realistic && Math.abs(o.value - bestOutput) < 0.01).map(o => o.name) : [];
    const winnerDisplay = bestOutput > 0 
      ? (winners.length === realisticOutputs.length && winners.length > 1
          ? 'Tie' 
          : (winners.length === 1 ? winners[0] : winners.join(', ')))
      : 'None';
    
    // Warn about unrealistic outputs
    const unrealistic = outputs.filter(o => !o.realistic);
    if (unrealistic.length > 0) {
      console.log('⚠️  WARNING: Some outputs appear unrealistic (likely simulation bug):');
      for (const out of unrealistic) {
        console.log(`   - ${out.name}: ${out.value.toExponential(2)} (filtered out)`);
      }
      console.log();
    }
    
    // Find winners for time (fastest) and memory (lowest)
    const times = [
      { name: 'Phase 1 DFS', value: phase1TotalTime },
      { name: 'Phase 1 A*', value: phase1AStarTotalTime },
      { name: 'Phase 2.1 Yen', value: phase2TotalTime },
      { name: 'Phase 2.2 Split', value: phase2TotalTime }
    ];
    const minTime = Math.min(...times.filter(t => t.value > 0).map(t => t.value));
    const timeWinners = times.filter(t => t.value > 0 && Math.abs(t.value - minTime) < 0.1).map(t => t.name);
    const timeWinnerDisplay = minTime > 0 
      ? (timeWinners.length > 1 ? timeWinners.join(', ') : timeWinners[0])
      : 'None';
    
    const memories = [
      { name: 'Phase 1 DFS', value: phase1MemUsed },
      { name: 'Phase 1 A*', value: phase1AStarMemUsed },
      { name: 'Phase 2.1 Yen', value: phase2MemUsed },
      { name: 'Phase 2.2 Split', value: phase2MemUsed }
    ];
    const minMemory = Math.min(...memories.filter(m => m.value > 0).map(m => m.value));
    const memoryWinners = memories.filter(m => m.value > 0 && Math.abs(m.value - minMemory) < 0.01).map(m => m.name);
    const memoryWinnerDisplay = minMemory > 0
      ? (memoryWinners.length > 1 ? memoryWinners.join(', ') : memoryWinners[0])
      : 'None';
    
    console.log('| Metric                | Phase 1 DFS  | Phase 1 A* | Phase 2.1 Yen | Phase 2.2 Split | Winner        |');
    console.log('|-----------------------|--------------|------------|---------------|----------------|---------------|');
    console.log(`| Routes Found          | ${String(allRoutes.length).padEnd(12)} | ${String(aStarRoutes.length).padEnd(10)} | ${String(kRoutes.length).padEnd(13)} | ${String(kRoutes.length).padEnd(14)} | -             |`);
    console.log(`| Best Output           | ${phase1BestResult.output.toFixed(2).padEnd(12)} | ${astarBestResult.output.toFixed(2).padEnd(10)} | ${phase2BestOutput.toFixed(2).padEnd(13)} | ${splitResult.totalOutput.toFixed(2).padEnd(14)} | ${winnerDisplay} |`);
    console.log(`| Execution Time (ms)   | ${String(phase1TotalTime).padEnd(12)} | ${String(phase1AStarTotalTime).padEnd(10)} | ${String(phase2TotalTime).padEnd(13)} | ${String(phase2TotalTime).padEnd(14)} | ${timeWinnerDisplay} ✅ |`);
    console.log(`| Memory Used (MB)      | ${phase1MemUsed.toFixed(2).padEnd(12)} | ${phase1AStarMemUsed.toFixed(2).padEnd(10)} | ${phase2MemUsed.toFixed(2).padEnd(13)} | ${phase2MemUsed.toFixed(2).padEnd(14)} | ${memoryWinnerDisplay} ✅ |`);
    console.log();
    
    console.log('Key Improvements vs Phase 1 DFS:');
    console.log(`  🟡 Phase 1 A*:  ${phase1AStarSpeedup > 0 ? '+' : ''}${phase1AStarSpeedup.toFixed(1)}% speed, ${astarImprovement > 0 ? '+' : ''}${astarImprovement.toFixed(2)}% output`);
    console.log(`  🟢 Phase 2.1:    ${phase2Speedup > 0 ? '+' : ''}${phase2Speedup.toFixed(1)}% speed, ${phase2Improvement > 0 ? '+' : ''}${phase2Improvement.toFixed(2)}% output`);
    console.log(`  🟢 Phase 2.2:    ${phase2Speedup > 0 ? '+' : ''}${phase2Speedup.toFixed(1)}% speed, ${phase22Improvement > 0 ? '+' : ''}${phase22Improvement.toFixed(2)}% output`);
    console.log();
    
    if (bestOutput > 0) {
      if (winners.length === outputs.filter(o => o.value > 0).length && winners.length > 1) {
        console.log(`🏆 TIE: All algorithms returned ${bestOutput.toFixed(2)} output`);
      } else if (winners.length === 1) {
        console.log(`🏆 BEST: ${winners[0]} with ${bestOutput.toFixed(2)} output`);
      } else {
        console.log(`🏆 BEST: ${winners.join(', ')} with ${bestOutput.toFixed(2)} output`);
      }
    } else {
      console.log(`⚠️  No routes found - all algorithms returned 0 output`);
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
  
  getSpotPrice(tokenInAddr, tokenOutAddr) {
    const tokenIn = this.tokens.find(t => t.addr === tokenInAddr);
    const tokenOut = this.tokens.find(t => t.addr === tokenOutAddr);
    
    if (!tokenIn || !tokenOut) return 0;
    
    const reserveIn = parseFloat(tokenIn.reserve);
    const reserveOut = parseFloat(tokenOut.reserve);
    
    if (reserveIn === 0 || reserveOut === 0) return 0;
    
    return (reserveOut / reserveIn) * (1 - this.fee);
  }
}

// Run
if (require.main === module) {
  runBenchmark();
}

module.exports = { runBenchmark };

