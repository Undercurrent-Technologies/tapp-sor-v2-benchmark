#!/usr/bin/env node

/**
 * SOR Phase 2 POC - Yen's K-Shortest Paths Algorithm
 * 
 * Proof of Concept implementation using real pool data from database.
 * 
 * Features:
 * 1. Graph Builder - Convert pools to weighted graph
 * 2. Dijkstra's Algorithm - Find shortest path
 * 3. Yen's K-Shortest Paths - Find top K routes
 * 4. Route Splitting - Optimize amount distribution
 * 5. Comparison - Phase 1 (single route) vs Phase 2 (K routes + splitting)
 * 
 * Usage:
 *   node yens-algorithm-poc.js APT USDC 10000 --k=5
 * 
 * Args:
 *   tokenFrom: Source token symbol (e.g., APT)
 *   tokenTo: Destination token symbol (e.g., USDC)
 *   amount: Amount to swap (in token units)
 *   --k: Number of routes to find (default: 5)
 *   --max-hops: Maximum hops per route (default: 5)
 *   --verbose: Show detailed logs
 */

require('dotenv').config();
const { Client } = require('pg');

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
const K = parseInt(args.find(a => a.startsWith('--k='))?.split('=')[1] || '5');
const maxHops = parseInt(args.find(a => a.startsWith('--max-hops='))?.split('=')[1] || '5');
const verbose = args.includes('--verbose');

// ============================================================================
// Data Structures
// ============================================================================

class PoolGraph {
  constructor() {
    this.nodes = new Map(); // token_addr → { addr, symbol, decimals }
    this.edges = [];        // [{ from, to, pool, weight }]
    this.adjacency = new Map(); // token_addr → [edges]
  }

  addNode(token) {
    if (!this.nodes.has(token.addr)) {
      this.nodes.set(token.addr, token);
      this.adjacency.set(token.addr, []);
    }
  }

  addEdge(tokenA, tokenB, pool, weight) {
    const edge = {
      from: tokenA.addr,
      to: tokenB.addr,
      pool,
      weight,
    };
    
    this.edges.push(edge);
    this.adjacency.get(tokenA.addr).push(edge);
    
    // Bidirectional edge (can swap both directions)
    const reverseEdge = {
      from: tokenB.addr,
      to: tokenA.addr,
      pool: { ...pool, reversed: true },
      weight,
    };
    
    this.edges.push(reverseEdge);
    this.adjacency.get(tokenB.addr).push(reverseEdge);
  }

  getNeighbors(tokenAddr) {
    return this.adjacency.get(tokenAddr) || [];
  }

  getToken(addr) {
    return this.nodes.get(addr);
  }
}

class PriorityQueue {
  constructor() {
    this.items = [];
  }

  push(item, priority) {
    this.items.push({ item, priority });
    this.items.sort((a, b) => a.priority - b.priority);
  }

  pop() {
    return this.items.shift()?.item;
  }

  isEmpty() {
    return this.items.length === 0;
  }
}

// ============================================================================
// Database Queries
// ============================================================================

async function fetchPoolsFromDB(client) {
  console.log('📊 Fetching pools from database...');
  
  const query = `
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
  
  const result = await client.query(query);
  console.log(`✅ Fetched ${result.rows.length} active pools\n`);
  
  return result.rows;
}

// ============================================================================
// Graph Builder
// ============================================================================

function buildLiquidityGraph(pools) {
  console.log('🏗️  Building liquidity graph...');
  
  const graph = new PoolGraph();
  let edgeCount = 0;
  
  for (const pool of pools) {
    if (pool.tokens.length !== 2) continue; // Skip non-pair pools
    
    const [tokenA, tokenB] = pool.tokens;
    
    // Add nodes
    graph.addNode(tokenA);
    graph.addNode(tokenB);
    
    // Calculate edge weight (lower = better)
    const weight = calculateEdgeWeight(pool, tokenA, tokenB);
    
    // Add edge (bidirectional)
    graph.addEdge(
      tokenA,
      tokenB,
      {
        addr: pool.pool_addr,
        type: pool.pool_type,
        fee: parseFloat(pool.fee_tier),
        liquidity: pool.liquidity,
        tokenA,
        tokenB,
      },
      weight
    );
    
    edgeCount += 2; // Bidirectional
  }
  
  console.log(`✅ Graph built:`);
  console.log(`   Nodes (tokens): ${graph.nodes.size}`);
  console.log(`   Edges (pools): ${edgeCount / 2} pools (${edgeCount} directed edges)\n`);
  
  return graph;
}

function calculateEdgeWeight(pool, tokenA, tokenB) {
  // Weight calculation: lower weight = better pool to use
  // Factors:
  // 1. Fee tier (lower fee = better)
  // 2. Liquidity (higher liquidity = better)
  // 3. Pool type efficiency
  
  const fee = parseFloat(pool.fee_tier);
  const liquidity = parseFloat(pool.liquidity);
  
  // Simulate small swap to estimate exchange rate
  const testAmount = 1000 * Math.pow(10, tokenA.decimals);
  const reserveA = parseFloat(tokenA.reserve);
  const reserveB = parseFloat(tokenB.reserve);
  
  if (reserveA === 0 || reserveB === 0) {
    return Infinity; // No liquidity
  }
  
  // Simple AMM formula: output = reserveB * testAmount / (reserveA + testAmount)
  const outputBeforeFee = (reserveB * testAmount) / (reserveA + testAmount);
  const outputAfterFee = outputBeforeFee * (1 - fee);
  const ratio = outputAfterFee / testAmount;
  
  if (ratio <= 0) {
    return Infinity;
  }
  
  // Weight = -log10(ratio)
  // Better ratio → lower weight (Dijkstra will prefer this edge)
  const weight = -Math.log10(ratio);
  
  return weight;
}

// ============================================================================
// Dijkstra's Algorithm
// ============================================================================

function dijkstra(graph, sourceAddr, targetAddr, maxHops, blockedEdges = new Set()) {
  if (verbose) console.log(`  🔍 Running Dijkstra from ${graph.getToken(sourceAddr)?.symbol} to ${graph.getToken(targetAddr)?.symbol}...`);
  
  const distances = new Map();
  const previous = new Map();
  const visited = new Set();
  const pq = new PriorityQueue();
  
  distances.set(sourceAddr, 0);
  pq.push({ token: sourceAddr, path: [] }, 0);
  
  while (!pq.isEmpty()) {
    const current = pq.pop();
    const { token, path } = current;
    
    if (visited.has(token)) continue;
    visited.add(token);
    
    // Found target!
    if (token === targetAddr) {
      const totalWeight = distances.get(token);
      if (verbose) console.log(`     ✅ Path found! Weight: ${totalWeight.toFixed(4)}, Hops: ${path.length}`);
      return {
        path,
        weight: totalWeight,
        hops: path.length,
      };
    }
    
    // Max hops reached
    if (path.length >= maxHops) continue;
    
    const currentDistance = distances.get(token);
    
    // Explore neighbors
    for (const edge of graph.getNeighbors(token)) {
      // Skip blocked edges (used in Yen's algorithm)
      const edgeKey = `${edge.from}-${edge.to}-${edge.pool.addr}`;
      if (blockedEdges.has(edgeKey)) continue;
      
      const neighbor = edge.to;
      const newDistance = currentDistance + edge.weight;
      
      if (!distances.has(neighbor) || newDistance < distances.get(neighbor)) {
        distances.set(neighbor, newDistance);
        previous.set(neighbor, { token, edge });
        
        pq.push(
          {
            token: neighbor,
            path: [...path, edge],
          },
          newDistance
        );
      }
    }
  }
  
  // No path found
  if (verbose) console.log(`     ❌ No path found`);
  return null;
}

// ============================================================================
// Yen's K-Shortest Paths Algorithm
// ============================================================================

function findKShortestPaths(graph, sourceAddr, targetAddr, K, maxHops) {
  console.log(`🎯 Finding ${K} shortest paths (max ${maxHops} hops)...`);
  console.log(`   From: ${graph.getToken(sourceAddr)?.symbol}`);
  console.log(`   To: ${graph.getToken(targetAddr)?.symbol}\n`);
  
  const paths = [];
  
  // Step 1: Find shortest path
  const shortestPath = dijkstra(graph, sourceAddr, targetAddr, maxHops);
  if (!shortestPath) {
    console.log('❌ No path found between these tokens!\n');
    return paths;
  }
  
  paths.push(shortestPath);
  console.log(`✅ Path #1: ${formatPath(graph, shortestPath)} (weight: ${shortestPath.weight.toFixed(4)})`);
  
  // Step 2: Find K-1 more paths (deviations)
  const candidates = [];
  
  for (let k = 1; k < K; k++) {
    if (verbose) console.log(`\n  🔄 Finding path #${k + 1}...`);
    
    // For each existing path, find deviations
    for (const existingPath of paths) {
      const { path } = existingPath;
      
      // Try deviating at each node in the path
      for (let i = 0; i < path.length; i++) {
        // Root path: edges before deviation point
        const rootPath = path.slice(0, i);
        const spurNode = i === 0 ? sourceAddr : path[i - 1].to;
        
        // Block edges used in existing paths at this deviation point
        const blockedEdges = new Set();
        
        for (const p of paths) {
          if (pathsShareRoot(p.path, rootPath)) {
            // Block the edge that this path uses after the root
            if (p.path.length > i) {
              const edgeToBlock = p.path[i];
              const edgeKey = `${edgeToBlock.from}-${edgeToBlock.to}-${edgeToBlock.pool.addr}`;
              blockedEdges.add(edgeKey);
            }
          }
        }
        
        // Find spur path (from spur node to target, avoiding blocked edges)
        const spurPath = dijkstra(
          graph,
          spurNode,
          targetAddr,
          maxHops - rootPath.length,
          blockedEdges
        );
        
        if (spurPath) {
          // Combine root path + spur path
          const fullPath = {
            path: [...rootPath, ...spurPath.path],
            weight: rootPath.reduce((sum, e) => sum + e.weight, 0) + spurPath.weight,
            hops: rootPath.length + spurPath.hops,
          };
          
          // Check if this is a new path (not duplicate)
          if (!isDuplicatePath(fullPath, [...paths, ...candidates])) {
            candidates.push(fullPath);
          }
        }
      }
    }
    
    if (candidates.length === 0) {
      console.log(`\n⚠️  No more alternative paths found (found ${paths.length} total)\n`);
      break;
    }
    
    // Pick best candidate
    candidates.sort((a, b) => a.weight - b.weight);
    const nextBest = candidates.shift();
    paths.push(nextBest);
    
    console.log(`✅ Path #${k + 1}: ${formatPath(graph, nextBest)} (weight: ${nextBest.weight.toFixed(4)})`);
  }
  
  console.log(`\n✅ Found ${paths.length} paths\n`);
  return paths;
}

function pathsShareRoot(path1, path2) {
  if (path2.length === 0) return true;
  if (path1.length < path2.length) return false;
  
  for (let i = 0; i < path2.length; i++) {
    if (path1[i].pool.addr !== path2[i].pool.addr) {
      return false;
    }
  }
  
  return true;
}

function isDuplicatePath(newPath, existingPaths) {
  for (const existing of existingPaths) {
    if (existing.path.length !== newPath.path.length) continue;
    
    let same = true;
    for (let i = 0; i < existing.path.length; i++) {
      if (existing.path[i].pool.addr !== newPath.path[i].pool.addr) {
        same = false;
        break;
      }
    }
    
    if (same) return true;
  }
  
  return false;
}

function formatPath(graph, pathObj) {
  const { path } = pathObj;
  if (path.length === 0) return 'Empty';
  
  const tokens = [graph.getToken(path[0].from)?.symbol];
  for (const edge of path) {
    tokens.push(graph.getToken(edge.to)?.symbol);
  }
  
  return tokens.join(' → ');
}

// ============================================================================
// Swap Simulation
// ============================================================================

function simulateSwap(edge, amountIn) {
  const { pool } = edge;
  const { tokenA, tokenB, fee } = pool;
  
  const reserveA = parseFloat(tokenA.reserve);
  const reserveB = parseFloat(tokenB.reserve);
  
  if (reserveA === 0 || reserveB === 0) {
    return 0;
  }
  
  // Determine direction
  const isReversed = pool.reversed;
  const [reserveIn, reserveOut] = isReversed
    ? [reserveB, reserveA]
    : [reserveA, reserveB];
  
  // AMM constant product formula
  // output = reserveOut * amountIn / (reserveIn + amountIn)
  const amountInAfterFee = amountIn * (1 - fee);
  const amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
  
  return amountOut;
}

function simulateRoute(graph, route, amount) {
  let currentAmount = amount;
  const amounts = [currentAmount];
  
  for (const edge of route.path) {
    currentAmount = simulateSwap(edge, currentAmount);
    amounts.push(currentAmount);
  }
  
  return {
    amountIn: amount,
    amountOut: currentAmount,
    amounts,
    route,
  };
}

// ============================================================================
// Route Splitting Optimizer
// ============================================================================

function optimizeRouteSplitting(graph, routes, totalAmount, maxSplits = 5) {
  console.log(`🔀 Optimizing route splitting for ${totalAmount} tokens across ${routes.length} routes...`);
  
  // Start: all amount on best route
  const allocation = [
    { routeIdx: 0, amount: totalAmount },
  ];
  
  const delta = totalAmount * 0.001; // 0.1% increments
  const maxIterations = 100;
  
  for (let iter = 0; iter < maxIterations && allocation.length < maxSplits; iter++) {
    let bestGain = 0;
    let bestMove = null;
    
    // Try moving delta from each allocated route to each available route
    for (let fromIdx = 0; fromIdx < allocation.length; fromIdx++) {
      const from = allocation[fromIdx];
      
      if (from.amount < delta) continue; // Can't move from this route
      
      for (let toRouteIdx = 0; toRouteIdx < routes.length; toRouteIdx++) {
        if (toRouteIdx === from.routeIdx) continue;
        
        // Calculate current output
        const currentOutput = calculateTotalOutput(graph, routes, allocation);
        
        // Calculate output after moving delta
        const testAllocation = moveAmount(allocation, fromIdx, toRouteIdx, delta);
        const newOutput = calculateTotalOutput(graph, routes, testAllocation);
        
        const gain = newOutput - currentOutput;
        
        if (gain > bestGain) {
          bestGain = gain;
          bestMove = { fromIdx, toRouteIdx, delta };
        }
      }
    }
    
    // No profitable move found
    if (bestGain <= 0 || !bestMove) {
      if (verbose) console.log(`   ℹ️  No profitable moves found after ${iter} iterations`);
      break;
    }
    
    // Apply best move
    const { fromIdx, toRouteIdx, delta: moveDelta } = bestMove;
    allocation[fromIdx].amount -= moveDelta;
    
    // Find or create allocation for toRoute
    const existing = allocation.find(a => a.routeIdx === toRouteIdx);
    if (existing) {
      existing.amount += moveDelta;
    } else {
      allocation.push({ routeIdx: toRouteIdx, amount: moveDelta });
    }
    
    // Remove allocations with near-zero amounts
    for (let i = allocation.length - 1; i >= 0; i--) {
      if (allocation[i].amount < 0.01) {
        allocation.splice(i, 1);
      }
    }
    
    if (verbose && iter % 10 === 0) {
      const output = calculateTotalOutput(graph, routes, allocation);
      console.log(`   Iter ${iter}: ${allocation.length} routes, output: ${output.toFixed(2)}`);
    }
  }
  
  // Final allocation
  const totalOutput = calculateTotalOutput(graph, routes, allocation);
  
  console.log(`\n✅ Optimal split found:`);
  allocation.sort((a, b) => b.amount - a.amount);
  for (const alloc of allocation) {
    const percentage = ((alloc.amount / totalAmount) * 100).toFixed(1);
    const routePath = formatPath(graph, routes[alloc.routeIdx]);
    console.log(`   ${percentage}% → Route ${alloc.routeIdx + 1}: ${routePath}`);
  }
  console.log(`   Total output: ${totalOutput.toFixed(2)}\n`);
  
  return { allocation, totalOutput };
}

function moveAmount(allocation, fromIdx, toRouteIdx, amount) {
  const newAllocation = allocation.map(a => ({ ...a }));
  newAllocation[fromIdx].amount -= amount;
  
  const existing = newAllocation.find(a => a.routeIdx === toRouteIdx);
  if (existing) {
    existing.amount += amount;
  } else {
    newAllocation.push({ routeIdx: toRouteIdx, amount });
  }
  
  return newAllocation;
}

function calculateTotalOutput(graph, routes, allocation) {
  let total = 0;
  
  for (const alloc of allocation) {
    const route = routes[alloc.routeIdx];
    const result = simulateRoute(graph, route, alloc.amount);
    total += result.amountOut;
  }
  
  return total;
}

// ============================================================================
// Comparison: Phase 1 vs Phase 2
// ============================================================================

function comparePhases(graph, routes, amount) {
  console.log('='  .repeat(80));
  console.log('📊 PHASE 1 vs PHASE 2 COMPARISON');
  console.log('='.repeat(80));
  console.log();
  
  // Phase 1: Single best route
  console.log('Phase 1: Single Route (Current Implementation)');
  console.log('-'.repeat(80));
  const bestRoute = routes[0];
  const phase1Result = simulateRoute(graph, bestRoute, amount);
  const phase1PriceImpact = ((amount - phase1Result.amountOut) / amount) * 100;
  
  console.log(`Route: ${formatPath(graph, bestRoute)}`);
  console.log(`Input: ${amount.toFixed(2)}`);
  console.log(`Output: ${phase1Result.amountOut.toFixed(2)}`);
  console.log(`Price Impact: ${phase1PriceImpact.toFixed(2)}%`);
  console.log();
  
  // Phase 2.1: Single route but with more hops (5 instead of 2)
  console.log('Phase 2.1: More Hops (3-5 hops, single route)');
  console.log('-'.repeat(80));
  const longerRoutes = routes.filter(r => r.hops >= 2);
  if (longerRoutes.length > 0) {
    const phase21Route = longerRoutes[0];
    const phase21Result = simulateRoute(graph, phase21Route, amount);
    const phase21PriceImpact = ((amount - phase21Result.amountOut) / amount) * 100;
    const phase21Improvement = ((phase21Result.amountOut - phase1Result.amountOut) / phase1Result.amountOut) * 100;
    
    console.log(`Route: ${formatPath(graph, phase21Route)}`);
    console.log(`Hops: ${phase21Route.hops}`);
    console.log(`Input: ${amount.toFixed(2)}`);
    console.log(`Output: ${phase21Result.amountOut.toFixed(2)}`);
    console.log(`Price Impact: ${phase21PriceImpact.toFixed(2)}%`);
    console.log(`Improvement vs Phase 1: ${phase21Improvement > 0 ? '+' : ''}${phase21Improvement.toFixed(2)}%`);
  } else {
    console.log('⚠️  No longer routes found');
  }
  console.log();
  
  // Phase 2.2: Route splitting
  console.log('Phase 2.2: Route Splitting (5 hops + split across routes)');
  console.log('-'.repeat(80));
  const splitResult = optimizeRouteSplitting(graph, routes, amount, 5);
  const phase22PriceImpact = ((amount - splitResult.totalOutput) / amount) * 100;
  const phase22Improvement = ((splitResult.totalOutput - phase1Result.amountOut) / phase1Result.amountOut) * 100;
  
  console.log(`Input: ${amount.toFixed(2)}`);
  console.log(`Output: ${splitResult.totalOutput.toFixed(2)}`);
  console.log(`Price Impact: ${phase22PriceImpact.toFixed(2)}%`);
  console.log(`Improvement vs Phase 1: ${phase22Improvement > 0 ? '+' : ''}${phase22Improvement.toFixed(2)}%`);
  console.log();
  
  // Summary table
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log();
  console.log('| Phase        | Output          | Price Impact | Improvement |');
  console.log('|--------------|-----------------|--------------|-------------|');
  console.log(`| Phase 1      | ${phase1Result.amountOut.toFixed(2).padEnd(15)} | ${phase1PriceImpact.toFixed(2).padEnd(12)}% | Baseline    |`);
  
  if (longerRoutes.length > 0) {
    const phase21Route = longerRoutes[0];
    const phase21Result = simulateRoute(graph, phase21Route, amount);
    const phase21Improvement = ((phase21Result.amountOut - phase1Result.amountOut) / phase1Result.amountOut) * 100;
    const phase21PriceImpact = ((amount - phase21Result.amountOut) / amount) * 100;
    console.log(`| Phase 2.1    | ${phase21Result.amountOut.toFixed(2).padEnd(15)} | ${phase21PriceImpact.toFixed(2).padEnd(12)}% | +${phase21Improvement.toFixed(2)}%      |`);
  }
  
  console.log(`| Phase 2.2    | ${splitResult.totalOutput.toFixed(2).padEnd(15)} | ${phase22PriceImpact.toFixed(2).padEnd(12)}% | +${phase22Improvement.toFixed(2)}%      |`);
  console.log();
  
  if (phase22Improvement > 20) {
    console.log('🎉 EXCELLENT! Phase 2.2 shows significant improvement!');
  } else if (phase22Improvement > 5) {
    console.log('✅ GOOD! Phase 2.2 shows improvement!');
  } else if (phase22Improvement > 0) {
    console.log('⚠️  Modest improvement. May need more liquidity or larger trade size.');
  } else {
    console.log('❌ No improvement. Current pools may not benefit from splitting.');
  }
  console.log();
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='  .repeat(80));
  console.log('SOR PHASE 2 POC - YEN\'S K-SHORTEST PATHS ALGORITHM');
  console.log('='.repeat(80));
  console.log();
  console.log(`Configuration:`);
  console.log(`  Token From: ${tokenFrom}`);
  console.log(`  Token To: ${tokenTo}`);
  console.log(`  Amount: ${swapAmount}`);
  console.log(`  K: ${K} (number of routes to find)`);
  console.log(`  Max Hops: ${maxHops}`);
  console.log(`  Verbose: ${verbose}`);
  console.log();
  console.log('='.repeat(80));
  console.log();
  
  const client = new Client(dbConfig);
  
  try {
    // Connect to database
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected\n');
    
    // Fetch pools
    const pools = await fetchPoolsFromDB(client);
    
    if (pools.length === 0) {
      console.log('❌ No pools found in database!');
      console.log('💡 Run seed script first: npm run seed:pools\n');
      return;
    }
    
    // Build graph
    const graph = buildLiquidityGraph(pools);
    
    // Find token addresses
    const sourceToken = Array.from(graph.nodes.values()).find(t => t.symbol === tokenFrom);
    const targetToken = Array.from(graph.nodes.values()).find(t => t.symbol === tokenTo);
    
    if (!sourceToken) {
      console.log(`❌ Token ${tokenFrom} not found in pools!\n`);
      console.log('Available tokens:');
      const tokens = Array.from(graph.nodes.values()).map(t => t.symbol);
      console.log(`  ${tokens.join(', ')}\n`);
      return;
    }
    
    if (!targetToken) {
      console.log(`❌ Token ${tokenTo} not found in pools!\n`);
      console.log('Available tokens:');
      const tokens = Array.from(graph.nodes.values()).map(t => t.symbol);
      console.log(`  ${tokens.join(', ')}\n`);
      return;
    }
    
    // Run Yen's algorithm
    const routes = findKShortestPaths(
      graph,
      sourceToken.addr,
      targetToken.addr,
      K,
      maxHops
    );
    
    if (routes.length === 0) {
      console.log(`❌ No routes found between ${tokenFrom} and ${tokenTo}!\n`);
      return;
    }
    
    // Compare phases
    comparePhases(graph, routes, swapAmount);
    
    console.log('✅ POC completed successfully!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (verbose) {
      console.error(error);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run
if (require.main === module) {
  main();
}

module.exports = {
  PoolGraph,
  buildLiquidityGraph,
  dijkstra,
  findKShortestPaths,
  optimizeRouteSplitting,
};

