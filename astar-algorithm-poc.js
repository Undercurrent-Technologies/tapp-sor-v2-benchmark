#!/usr/bin/env node

/**
 * A* Algorithm POC - Proof of Concept
 * 
 * Implementation of A* search with target-aware heuristic for token routing.
 * This is a simplified POC version for investigation and testing.
 * 
 * Key Features:
 * - A* search with reverse Dijkstra heuristic
 * - K-best route tracking
 * - Gas cost modeling
 * - Bitset visited tracking
 * - Beam width limiting
 * 
 * Usage:
 *   node astar-algorithm-poc.js DOGE BTC 10000 --max-hops=3 --top-k=10 --beam=64 --verbose
 */

require('dotenv').config();
const { Client } = require('pg');

// ============================================================================
// Configuration
// ============================================================================

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5433,
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
const topK = parseInt(args.find(a => a.startsWith('--top-k='))?.split('=')[1] || '10');
const beamWidth = parseInt(args.find(a => a.startsWith('--beam='))?.split('=')[1] || '64');
const gasPerHopUSD = parseFloat(args.find(a => a.startsWith('--gas-per-hop='))?.split('=')[1] || '0.01');
const verbose = args.includes('--verbose');

// ============================================================================
// Data Structures
// ============================================================================

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

// ============================================================================
// Database Queries
// ============================================================================

async function fetchPoolsFromDB(client) {
  if (verbose) console.log('📊 Fetching pools from database...');
  
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
  if (verbose) console.log(`✅ Fetched ${result.rows.length} active pools\n`);
  
  return result.rows.map(row => new PoolWrapper(row));
}

async function getTokenMap(client) {
  const query = `
    SELECT addr, ticker as symbol, decimals
    FROM tokens
  `;
  const result = await client.query(query);
  
  const tokenMap = new Map();
  for (const row of result.rows) {
    tokenMap.set(row.addr, row);
  }
  
  return tokenMap;
}

// ============================================================================
// Min-Heap Implementation
// ============================================================================

class MinHeap {
  constructor(compareFn = (a, b) => a.score - b.score) {
    this.heap = [];
    this.compareFn = compareFn;
  }
  
  size() {
    return this.heap.length;
  }
  
  peek() {
    return this.heap[0];
  }
  
  push(item) {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }
  
  pop() {
    if (this.heap.length === 0) return null;
    if (this.heap.length === 1) return this.heap.pop();
    
    const min = this.heap[0];
    this.heap[0] = this.heap.pop();
    this.bubbleDown(0);
    return min;
  }
  
  bubbleUp(idx) {
    while (idx > 0) {
      const parentIdx = Math.floor((idx - 1) / 2);
      if (this.compareFn(this.heap[idx], this.heap[parentIdx]) >= 0) break;
      
      [this.heap[idx], this.heap[parentIdx]] = [this.heap[parentIdx], this.heap[idx]];
      idx = parentIdx;
    }
  }
  
  bubbleDown(idx) {
    while (true) {
      const leftIdx = 2 * idx + 1;
      const rightIdx = 2 * idx + 2;
      let minIdx = idx;
      
      if (leftIdx < this.heap.length && this.compareFn(this.heap[leftIdx], this.heap[minIdx]) < 0) {
        minIdx = leftIdx;
      }
      if (rightIdx < this.heap.length && this.compareFn(this.heap[rightIdx], this.heap[minIdx]) < 0) {
        minIdx = rightIdx;
      }
      
      if (minIdx === idx) break;
      
      [this.heap[idx], this.heap[minIdx]] = [this.heap[minIdx], this.heap[idx]];
      idx = minIdx;
    }
  }
  
  toSortedArray() {
    return [...this.heap].sort((a, b) => -this.compareFn(a, b));
  }
}

// ============================================================================
// Max-Heap Implementation
// ============================================================================

class MaxHeap extends MinHeap {
  constructor(compareFn = (a, b) => a.score - b.score) {
    super((a, b) => -compareFn(a, b));
  }
}

// ============================================================================
// Bitset Utilities
// ============================================================================

function bitsetHas(bitset, idx) {
  return ((bitset >> BigInt(idx)) & 1n) !== 0n;
}

function bitsetAdd(bitset, idx) {
  return bitset | (1n << BigInt(idx));
}

// ============================================================================
// A* Heuristic: Reverse Dijkstra
// ============================================================================

const MAX_NODES = 10000;
const MAX_ITERATIONS = 10000;
const heuristicCache = new Map();

function computeReverseHeuristic(adj, targetAddr, gasPerHopPenalty = 0, sourceTokenAddr = null) {
  const cacheKey = `${targetAddr}:${gasPerHopPenalty.toFixed(6)}`;
  
  if (heuristicCache.has(cacheKey)) {
    if (verbose) console.log('🎯 Using cached heuristic');
    return heuristicCache.get(cacheKey);
  }
  
  const reverseAdj = new Map();
  
  // Build reverse adjacency map
  for (const [from, edges] of adj) {
    for (const edge of edges) {
      const arr = reverseAdj.get(edge.to) || [];
      arr.push({
        to: from,
        weight: -edge.logSpotPrice + gasPerHopPenalty,
      });
      reverseAdj.set(edge.to, arr);
    }
  }
  
  const dist = new Map();
  const pq = new MinHeap((a, b) => a.dist - b.dist);
  
  dist.set(targetAddr, 0);
  pq.push({ node: targetAddr, dist: 0 });
  
  let iterations = 0;
  let nodesExplored = 0;
  
  while (pq.size() > 0 && nodesExplored < MAX_NODES && iterations < MAX_ITERATIONS) {
    const { node, dist: d } = pq.pop();
    
    if (d > dist.get(node)) continue;
    
    nodesExplored++;
    iterations++;
    
    const edges = reverseAdj.get(node) || [];
    for (const edge of edges) {
      const newDist = d + edge.weight;
      const currentDist = dist.get(edge.to) ?? Infinity;
      
      if (newDist < currentDist) {
        dist.set(edge.to, newDist);
        pq.push({ node: edge.to, dist: newDist });
      }
    }
  }
  
  if (verbose) {
    console.log(`✅ Computed heuristic for ${dist.size} nodes (${nodesExplored} explored, ${iterations} iterations)`);
    if (sourceTokenAddr) {
      const sourceH = dist.get(sourceTokenAddr) ?? Infinity;
      console.log(`Source: ${sourceTokenAddr}, Heuristic: ${sourceH === Infinity ? 'Infinity' : sourceH.toFixed(4)}`);
    }
    const targetH = dist.get(targetAddr) ?? Infinity;
    console.log(`Target: ${targetAddr}, Heuristic: ${targetH === Infinity ? 'Infinity' : targetH.toFixed(4)}`);
  }
  
  if (sourceTokenAddr && !dist.has(sourceTokenAddr)) {
    console.log(`⚠️  Warning: Source heuristic is Infinity. Falling back to uniform heuristic (0).`);
  }
  
  if (verbose) console.log(`Heuristic map size: ${dist.size} nodes`);
  
  heuristicCache.set(cacheKey, dist);
  
  return dist;
}

function mapHeuristicToIds(heuristicAddrMap, tokenToId) {
  const hId = new Map();
  for (const [addr, val] of heuristicAddrMap) {
    const id = tokenToId.get(addr);
    if (id !== undefined) hId.set(id, val);
  }
  return hId;
}

// ============================================================================
// Graph Building
// ============================================================================

function buildAdjacencyMap(pools, tokenMap) {
  if (verbose) console.log('🔧 Building adjacency map...');
  
  const adj = new Map();
  const tokenToId = new Map();
  const poolToId = new Map();
  let nextTokenId = 0;
  let nextPoolId = 0;
  
  for (const [addr] of tokenMap) {
    tokenToId.set(addr, nextTokenId++);
    adj.set(addr, []);
  }
  
  for (const pool of pools) {
    poolToId.set(pool.addr, nextPoolId++);
    
    for (const token of pool.tokens) {
      const otherToken = pool.getOtherToken(token.addr);
      if (!otherToken) continue;
      
      const reserveIn = parseFloat(token.reserve);
      const reserveOut = parseFloat(otherToken.reserve);
      
      if (reserveIn === 0 || reserveOut === 0) continue;
      if (reserveIn < 1 || reserveOut < 1) continue;
      
      const spotPrice = pool.getSpotPrice(token.addr, otherToken.addr);
      if (spotPrice === 0) continue;
      
      const liquidityScore = Math.sqrt(reserveIn * reserveOut);
      
      const probeSize = 1000;
      const priceImpact = probeSize / (reserveIn + probeSize);
      if (priceImpact > 0.05) continue;
      
      const logSpotPrice = Math.log(spotPrice + 1e-9);
      const logLiquidity = Math.log(liquidityScore + 1e-9);
      const score = logSpotPrice + logLiquidity;
      
      const edges = adj.get(token.addr) || [];
      edges.push({
        to: otherToken.addr,
        pool,
        poolId: poolToId.get(pool.addr),
        spotPrice,
        logSpotPrice,
        liquidityScore,
        score,
      });
      adj.set(token.addr, edges);
    }
  }
  
  for (const [tokenAddr, edges] of adj) {
    edges.sort((a, b) => b.score - a.score);
  }
  
  if (verbose) console.log(`✅ Built adjacency map with ${adj.size} tokens\n`);
  
  return { adj, tokenToId, poolToId };
}

function compressParallelEdges(adj) {
  if (verbose) console.log('🔧 Compressing parallel edges...');
  
  let originalCount = 0;
  let compressedCount = 0;
  
  for (const [tokenAddr, edges] of adj) {
    originalCount += edges.length;
    
    const bestEdges = new Map();
    
    for (const edge of edges) {
      const key = edge.to;
      const existing = bestEdges.get(key) || [];
      existing.push(edge);
      bestEdges.set(key, existing);
    }
    
    const compressed = [];
    for (const edgeList of bestEdges.values()) {
      edgeList.sort((a, b) => b.score - a.score);
      
      compressed.push(edgeList[0]);
      if (edgeList.length > 1) {
        const bestPrice = edgeList[0].spotPrice;
        const secondPrice = edgeList[1].spotPrice;
        const priceDeltaBps = Math.abs((secondPrice - bestPrice) / bestPrice) * 10000;
        if (priceDeltaBps <= 50) {
          compressed.push(edgeList[1]);
        }
      }
    }
    
    compressed.sort((a, b) => b.score - a.score);
    adj.set(tokenAddr, compressed);
    compressedCount += compressed.length;
  }
  
  if (verbose) console.log(`✅ Compressed ${originalCount} → ${compressedCount} edges (${((1 - compressedCount/originalCount) * 100).toFixed(1)}% reduction)\n`);
  
  return adj;
}

function buildNumericAdjacency(adj, tokenToId) {
  if (verbose) console.log('🔧 Building numeric adjacency...');
  
  const adjId = new Map();
  const idToAddr = new Map();
  
  for (const [addr, id] of tokenToId) {
    idToAddr.set(id, addr);
  }
  
  for (const [fromAddr, edges] of adj) {
    const fromId = tokenToId.get(fromAddr);
    const numericEdges = edges.map(edge => ({
      toId: tokenToId.get(edge.to),
      toAddr: edge.to,
      poolId: edge.poolId,
      pool: edge.pool,
      spotPrice: edge.spotPrice,
      logSpotPrice: edge.logSpotPrice,
      liquidityScore: edge.liquidityScore,
      score: edge.score,
    }));
    adjId.set(fromId, numericEdges);
  }
  
  if (verbose) console.log(`✅ Built numeric adjacency with ${adjId.size} token IDs\n`);
  
  return { adjId, idToAddr };
}

// ============================================================================
// A* Search Algorithm
// ============================================================================

function findTopKRoutesAStar(adjId, heuristicId, tokenToId, idToAddr, tokenInAddr, tokenOutAddr, maxHops, topK, beamWidth, gasPerHopPenalty) {
  const ASTAR_MAX_ITERATIONS = 50000;
  
  if (verbose) console.log(`A* search starting (max ${ASTAR_MAX_ITERATIONS} iterations)...`);
  
  if (tokenInAddr === tokenOutAddr) {
    if (verbose) console.log('⚠️  Source and target are the same\n');
    return [];
  }
  
  const candidatesHeap = new MinHeap();
  let kthScore = -Infinity;
  const seenRoutes = new Set();
  
  const sourceId = tokenToId.get(tokenInAddr);
  const targetId = tokenToId.get(tokenOutAddr);
  
  const frontierHeap = new MaxHeap((a, b) => a.prio - b.prio);
  
  const sourceH = heuristicId.get(sourceId) ?? Infinity;
  const effectiveH = sourceH === Infinity ? 0 : sourceH;
  const sourcePrio = 0 - effectiveH - gasPerHopPenalty * maxHops;
  
  frontierHeap.push({
    nodeId: sourceId,
    parent: null,
    edge: null,
    visitedBits: bitsetAdd(0n, sourceId),
    score: 0,
    prio: sourcePrio,
    hops: 0,
    prevNodeId: null,
  });
  
  let nodesExplored = 0;
  let iterationCount = 0;
  
  function reconstructPath(state) {
    const path = [];
    let current = state;
    while (current.parent !== null) {
      path.unshift(current.edge);
      current = current.parent;
    }
    return path;
  }
  
  while (frontierHeap.size() > 0 && iterationCount < ASTAR_MAX_ITERATIONS) {
    iterationCount++;
    const topFrontier = frontierHeap.peek();
    
    if (candidatesHeap.size() >= topK && topFrontier.prio <= kthScore) {
      if (verbose) console.log(`🚀 Early termination: prio ${topFrontier.prio.toFixed(4)} ≤ kthScore ${kthScore.toFixed(4)}`);
      break;
    }
    
    const expansionLimit = Math.min(frontierHeap.size(), beamWidth);
    
    for (let i = 0; i < expansionLimit && frontierHeap.size() > 0; i++) {
      const partial = frontierHeap.pop();
      nodesExplored++;
      
      if (partial.hops >= maxHops) continue;
      
      // Use effective heuristic (0 if Infinity)
      const h = heuristicId.get(partial.nodeId) ?? Infinity;
      const effectiveH = h === Infinity ? 0 : h;
      
      const remainingHops = maxHops - partial.hops;
      const upperBound = partial.score - effectiveH - (gasPerHopPenalty * remainingHops);
      
      if (candidatesHeap.size() >= topK && upperBound <= kthScore) continue;
      
      const edges = adjId.get(partial.nodeId) || [];
      const edgeLimit = Math.min(edges.length, 16);
      
      for (let ei = 0; ei < edgeLimit; ei++) {
        const edge = edges[ei];
        const nextNodeId = edge.toId;
        
        if (bitsetHas(partial.visitedBits, nextNodeId)) continue;
        if (partial.prevNodeId !== null && nextNodeId === partial.prevNodeId) continue;
        
        const newScore = partial.score + edge.logSpotPrice - gasPerHopPenalty;
        const newHops = partial.hops + 1;
        const rem = maxHops - newHops;
        const hRem = heuristicId.get(nextNodeId) ?? Infinity;
        const effectiveHRem = hRem === Infinity ? 0 : hRem;
        const prio = newScore - effectiveHRem - (gasPerHopPenalty * rem);
        
        if (nextNodeId !== targetId && candidatesHeap.size() >= topK && prio <= kthScore) {
          continue;
        }
        
        const newEdge = {
          pool: edge.pool,
          poolId: edge.poolId,
          fromId: partial.nodeId,
          toId: nextNodeId,
          fromAddr: idToAddr.get(partial.nodeId),
          toAddr: edge.toAddr,
        };
        
        if (nextNodeId === targetId) {
          const newState = {
            parent: partial,
            edge: newEdge,
          };
          
          const route = reconstructPath(newState);
          const routeKey = route.map(e => `${e.fromId}:${e.poolId}:${e.toId}`).join('|');
          
          if (seenRoutes.has(routeKey)) continue;
          seenRoutes.add(routeKey);
          
          if (verbose) {
            console.log(`   ✅ Found route #${candidatesHeap.size() + 1}, score: ${newScore.toFixed(4)}, hops: ${route.length}`);
          }
          
          if (candidatesHeap.size() < topK) {
            candidatesHeap.push({ route, score: newScore });
            if (candidatesHeap.size() === topK) {
              kthScore = candidatesHeap.peek().score;
            }
          } else if (newScore > kthScore) {
            candidatesHeap.pop();
            candidatesHeap.push({ route, score: newScore });
            kthScore = candidatesHeap.peek().score;
          }
          continue;
        }
        
        if (newHops < maxHops) {
          const newVisitedBits = bitsetAdd(partial.visitedBits, nextNodeId);
          
          const newNode = {
            nodeId: nextNodeId,
            parent: partial,
            edge: newEdge,
            visitedBits: newVisitedBits,
            score: newScore,
            prio,
            hops: newHops,
            prevNodeId: partial.nodeId,
          };
          
          frontierHeap.push(newNode);
        }
      }
    }
  }
  
  if (verbose) console.log(`\n✅ Found ${candidatesHeap.size()} routes (explored: ${nodesExplored})\n`);
  
  return candidatesHeap.toSortedArray().map(c => c.route);
}

// ============================================================================
// Swap Simulation
// ============================================================================

function simulateSwap(pool, tokenInAddr, tokenOutAddr, amountIn) {
  const tokenIn = pool.tokens.find(t => t.addr === tokenInAddr);
  const tokenOut = pool.tokens.find(t => t.addr === tokenOutAddr);
  
  if (!tokenIn || !tokenOut) return 0;
  
  const reserveIn = parseFloat(tokenIn.reserve);
  const reserveOut = parseFloat(tokenOut.reserve);
  
  if (reserveIn === 0 || reserveOut === 0) return 0;
  
  const amountInAfterFee = amountIn * (1 - pool.fee);
  const amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
  
  return amountOut;
}

function simulateRoute(route, amount) {
  let currentAmount = amount;
  
  for (const hop of route) {
    currentAmount = simulateSwap(hop.pool, hop.fromAddr, hop.toAddr, currentAmount);
    if (currentAmount === 0) break;
  }
  
  return currentAmount;
}

function selectBestRoute(routes, amount, gasPerHopInOutputTokens) {
  if (verbose) console.log(`🎯 Evaluating ${routes.length} routes...`);
  
  let bestRoute = null;
  let bestNetOutput = 0;
  
  for (const route of routes) {
    const output = simulateRoute(route, amount);
    const gasCost = route.length * gasPerHopInOutputTokens;
    const netOutput = output - gasCost;
    
    if (netOutput > bestNetOutput) {
      bestNetOutput = netOutput;
      bestRoute = route;
    }
  }
  
  if (verbose) console.log(`✅ Best route net output: ${bestNetOutput.toFixed(2)}\n`);
  
  return { route: bestRoute, output: bestNetOutput };
}

// ============================================================================
// Display & Format
// ============================================================================

function formatRoute(route, tokenMap) {
  if (!route || route.length === 0) return 'Empty';
  
  const tokens = [tokenMap.get(route[0].fromAddr)?.symbol || 'Unknown'];
  for (const hop of route) {
    tokens.push(tokenMap.get(hop.toAddr)?.symbol || 'Unknown');
  }
  
  return tokens.join(' → ');
}

function displayResults(routes, bestResult, amount, tokenMap) {
  console.log('='.repeat(80));
  console.log('📊 A* ALGORITHM RESULTS');
  console.log('='.repeat(80));
  console.log();
  
  console.log(`Results:`);
  console.log(`  Routes found: ${routes.length}`);
  console.log(`  Best output: ${bestResult.output.toFixed(2)}`);
  
  const priceImpact = ((amount - bestResult.output) / amount) * 100;
  console.log(`  Price Impact: ${priceImpact.toFixed(2)}%`);
  console.log();
  
  if (routes.length > 0) {
    console.log(`Best Route:`);
    console.log(`  Path: ${formatRoute(bestResult.route, tokenMap)}`);
    console.log(`  Hops: ${bestResult.route?.length || 0}`);
    console.log(`  Input: ${amount.toFixed(2)}`);
    console.log(`  Output: ${bestResult.output.toFixed(2)}`);
    console.log();
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('A* ALGORITHM POC - PROOF OF CONCEPT');
  console.log('='.repeat(80));
  console.log();
  console.log(`Configuration:`);
  console.log(`  Token From: ${tokenFrom}`);
  console.log(`  Token To: ${tokenTo}`);
  console.log(`  Amount: ${swapAmount}`);
  console.log(`  Max Hops: ${maxHops}`);
  console.log(`  Top K: ${topK}`);
  console.log(`  Beam Width: ${beamWidth}`);
  console.log(`  Gas Per Hop: $${gasPerHopUSD}`);
  console.log();
  console.log('='.repeat(80));
  console.log();
  
  const client = new Client(dbConfig);
  
  try {
    if (verbose) console.log('📡 Connecting to database...');
    await client.connect();
    if (verbose) console.log('✅ Connected\n');
    
    const pools = await fetchPoolsFromDB(client);
    const tokenMap = await getTokenMap(client);
    
    if (pools.length === 0) {
      if (verbose) console.log('❌ No pools found!\n');
      return;
    }
    
    const sourceToken = Array.from(tokenMap.values()).find(t => t.symbol === tokenFrom);
    const targetToken = Array.from(tokenMap.values()).find(t => t.symbol === tokenTo);
    
    if (!sourceToken || !targetToken) {
      if (verbose) console.log('❌ Token not found!\n');
      return;
    }
    
    if (verbose) console.log('🔧 Preprocessing graph...');
    
    const { adj, tokenToId, poolToId } = buildAdjacencyMap(pools, tokenMap);
    compressParallelEdges(adj);
    const { adjId, idToAddr } = buildNumericAdjacency(adj, tokenToId);
    
    const targetTokenUSDPrice = 1.0;
    const gasPerHopInOutputTokens = gasPerHopUSD / targetTokenUSDPrice;
    const gasPerHopPenalty = gasPerHopUSD > 0 ? Math.log(1 + gasPerHopInOutputTokens / swapAmount) : 0;
    
    if (verbose) console.log(`🔧 Gas per hop: $${gasPerHopUSD} → ${gasPerHopInOutputTokens.toFixed(4)} ${targetToken.symbol} → penalty ${gasPerHopPenalty.toFixed(6)}`);
    
    if (verbose) console.log('🔧 Computing A* heuristic (reverse Dijkstra)...');
    const heuristic = computeReverseHeuristic(adj, targetToken.addr, gasPerHopPenalty, sourceToken.addr);
    const heuristicId = mapHeuristicToIds(heuristic, tokenToId);
    
    const allRoutes = findTopKRoutesAStar(adjId, heuristicId, tokenToId, idToAddr, sourceToken.addr, targetToken.addr, maxHops, topK, beamWidth, gasPerHopPenalty);
    
    if (allRoutes.length === 0) {
      if (verbose) console.log('❌ No routes found!\n');
      return;
    }
    
    const bestResult = selectBestRoute(allRoutes, swapAmount, gasPerHopInOutputTokens);
    displayResults(allRoutes, bestResult, swapAmount, tokenMap);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (verbose) console.error(error);
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
  findTopKRoutesAStar,
  selectBestRoute,
  simulateRoute,
  buildAdjacencyMap,
  computeReverseHeuristic,
  mapHeuristicToIds,
  buildNumericAdjacency,
  main,
};
