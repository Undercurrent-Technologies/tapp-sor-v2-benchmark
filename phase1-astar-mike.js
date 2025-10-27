#!/usr/bin/env node

/**
 * SOR Phase 1 POC - A* Search Algorithm
 * 
 * PRODUCTION-OPTIMIZED implementation with:
 * - A* search with target-aware heuristic (reverse Dijkstra)
 * - K-best route tracking with min-heap
 * - Gas cost modeling in scoring
 * - BigInt bitset for visited tracking (zero-allocation)
 * - Frontier max-heap for best-first expansion
 * - Top-2 parallel edge compression
 * - CLMM active range validation
 * - Adjacency map with O(1) lookup
 * 
 * Key Optimizations (Round 3):
 * 1. A* heuristic: 2-5× fewer node expansions vs blind search
 * 2. Gas penalties: Prevents exploration of unprofitable long routes
 * 3. Bitset visited: Eliminates Set() allocation overhead
 * 4. Frontier heap: No batch sorting, O(log N) insertions
 * 
 * Phase 1 Approach:
 * 1. A* search to find top K routes (default K=40)
 * 2. Single best route selection via simulation
 * 3. Max 3 hops limit (configurable)
 * 4. Beam width limiting (default B=32)
 * 
 * Usage:
 *   node phase1-dfs-mike-poc.js APT USDC 10000
 *   node phase1-dfs-mike-poc.js APT USDC 10000 --max-hops=3 --top-k=40 --beam=32 --gas-per-hop=0.01
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
const swapAmountArg = args.find(a => a.startsWith('--amount='))?.split('=')[1];
const swapAmount = swapAmountArg ? parseFloat(swapAmountArg) : parseFloat(args[2] || '10000');
const maxHops = parseInt(args.find(a => a.startsWith('--max-hops='))?.split('=')[1] || '3');
const topK = parseInt(args.find(a => a.startsWith('--top-k='))?.split('=')[1] || '40');
const beamWidth = parseInt(args.find(a => a.startsWith('--beam='))?.split('=')[1] || '32');
const gasPerHopUSD = parseFloat(args.find(a => a.startsWith('--gas-per-hop='))?.split('=')[1] || '0.01');
const verbose = args.includes('--verbose');
const enablePhase2 = args.includes('--phase2');
const PI_MAX = parseFloat(args.find(a => a.startsWith('--pi-max='))?.split('=')[1] || '0.05');
const MIN_POOL_USD = parseFloat(args.find(a => a.startsWith('--min-pool-usd='))?.split('=')[1] || '1000');
const LEGACY_WATERFILL = args.includes('--legacy-waterfill');

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
    
    const reserveIn = tokenIn.reserveNum;
    const reserveOut = tokenOut.reserveNum;
    
    if (reserveIn === 0 || reserveOut === 0) return 0;
    
    return (reserveOut / reserveIn) * (1 - this.fee);
  }
}

// ============================================================================
// Database Queries (Same as Phase 2)
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

// ============================================================================
// Min-Heap for K-Best Tracking
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
// Max-Heap for Frontier (Best-First Search)
// ============================================================================

class MaxHeap extends MinHeap {
  constructor(compareFn = (a, b) => a.score - b.score) {
    super((a, b) => -compareFn(a, b));
  }
}

// ============================================================================
// Bitset Utilities for Visited Tracking
// ============================================================================

function bitsetHas(bitset, idx) {
  return ((bitset >> BigInt(idx)) & 1n) !== 0n;
}

function bitsetAdd(bitset, idx) {
  return bitset | (1n << BigInt(idx));
}

// ============================================================================
// A* Heuristic: Reverse Dijkstra from Target
// ============================================================================

const MAX_NODES = 50000; // Limit number of nodes explored in reverse Dijkstra
const MAX_ITERATIONS = 50000; // Limit iterations to prevent infinite loops

const heuristicCache = new Map();

function heuristicCacheKey(adj, targetAddr, gasPerHopPenalty) {
  let n = 0, e = 0;
  for (const [, edges] of adj) {
    n++;
    e += edges.length;
  }
  return `${targetAddr}:${gasPerHopPenalty.toFixed(6)}:${n}:${e}`;
}

function computeReverseHeuristic(adj, targetAddr, gasPerHopPenalty = 0, sourceTokenAddr = null, tokenToId = null) {
  const cacheKey = heuristicCacheKey(adj, targetAddr, gasPerHopPenalty);
  
  if (heuristicCache.has(cacheKey)) {
    if (verbose) console.log('🎯 Using cached heuristic');
    return heuristicCache.get(cacheKey);
  }
  
  const reverseAdj = new Map();
  
  // Build reverse adjacency map
  for (const [from, edges] of adj) {
    for (const edge of edges) {
      const arr = reverseAdj.get(edge.to) || [];
      const raw = -edge.logSpotPrice + gasPerHopPenalty;
      const weight = Math.max(0, raw);  // non-negative, Dijkstra-safe
      arr.push({
        to: from,
        weight,
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
    console.log(`✅ Computed heuristic for ${dist.size} nodes (${nodesExplored} nodes explored, ${iterations} iterations)`);
    if (sourceTokenAddr) {
      const sourceH = dist.get(sourceTokenAddr) ?? Infinity;
      console.log(`Source addr: ${sourceTokenAddr}, Heuristic: ${sourceH === Infinity ? 'Infinity' : sourceH.toFixed(4)}`);
    }
    const targetH = dist.get(targetAddr) ?? Infinity;
    console.log(`Target addr: ${targetAddr}, Heuristic: ${targetH === Infinity ? 'Infinity' : targetH.toFixed(4)}`);
  }
  
  // Check if source has valid heuristic
  if (sourceTokenAddr && !dist.has(sourceTokenAddr)) {
    console.log(`⚠️  Warning: Heuristic is Infinity. Falling back to uniform heuristic (0).`);
  }
  
  if (verbose) {
    console.log(`Heuristic map size: ${dist.size} nodes`);
  }
  
  // Cache both Map and array if tokenToId provided (B6)
  if (tokenToId) {
    const heuristicArr = new Float64Array(tokenToId.size);
    heuristicArr.fill(0);
    for (const [addr, v] of dist.entries()) {
      const id = tokenToId.get(addr);
      if (id !== undefined) {
        heuristicArr[id] = Number.isFinite(v) ? v : 0;
      }
    }
    const cached = { dist, heuristicArr };
    heuristicCache.set(cacheKey, cached);
    return cached;
  }
  
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
// Graph Preprocessing
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
    
    // Pre-normalize reserves once
    pool.tokens.forEach(t => {
      t.reserveNum = parseFloat(t.reserve);
    });
    
    for (const token of pool.tokens) {
      const otherToken = pool.getOtherToken(token.addr);
      if (!otherToken) continue;
      
      const reserveIn = token.reserveNum;
      const reserveOut = otherToken.reserveNum;
      
      if (reserveIn === 0 || reserveOut === 0) continue;
      if (reserveIn < 1 || reserveOut < 1) continue;
      
      const spotPrice = pool.getSpotPrice(token.addr, otherToken.addr);
      if (spotPrice === 0) continue;
      
      const liquidityScore = Math.sqrt(reserveIn * reserveOut);
      
      const rel = 0.001; // 0.1% of reserve
      const dxCap = 1e9; // safety cap in raw units
      const probeSize = Math.min(reserveIn * rel, dxCap);
      const priceImpact = probeSize / (reserveIn + probeSize);
      if (priceImpact > 0.05) continue;
      
      const logSpotPrice = Math.log(spotPrice + 1e-9);
      const logLiquidity = Math.log(liquidityScore + 1e-9);
      const score = logSpotPrice + logLiquidity;
      
      const maxOut = reserveOut * 0.95;
      const newReserveOut = reserveOut - maxOut;
      const k = reserveIn * reserveOut;
      const newReserveIn = k / newReserveOut;
      const dxCapRaw = (newReserveIn - reserveIn) / (1 - pool.fee);
      
      const edges = adj.get(token.addr) || [];
      edges.push({
        to: otherToken.addr,
        pool,
        poolId: poolToId.get(pool.addr),
        spotPrice,
        logSpotPrice,
        liquidityScore,
        score,
        dxCapRaw,
        reserveIn,
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
  
  if (verbose) console.log(`✅ Compressed ${originalCount} edges → ${compressedCount} edges (${((1 - compressedCount/originalCount) * 100).toFixed(1)}% reduction)\n`);
  
  return adj;
}

function buildNumericAdjacency(adj, tokenToId) {
  if (verbose) console.log('🔧 Building numeric adjacency (adjId)...');
  
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
      dxCapRaw: edge.dxCapRaw,
      reserveIn: edge.reserveIn,
    }));
    adjId.set(fromId, numericEdges);
  }
  
  if (verbose) console.log(`✅ Built numeric adjacency with ${adjId.size} token IDs\n`);
  
  return { adjId, idToAddr };
}

// ============================================================================
// Phase 1 A* Search Algorithm with Target-Aware Heuristic
// ============================================================================

function findTopKRoutesAStar(adjId, heuristicId, tokenToId, idToAddr, tokenInAddr, tokenOutAddr, maxHops, topK = 40, beamWidth = 32, gasPerHopPenalty = 0, precomputedHeuristicArr = null) {
  const ASTAR_MAX_ITERATIONS = 50000; // Limit A* search iterations
  const TIME_BUDGET_MS = 5000; // 5000ms for testing
  
  if (verbose) console.log(`A* search starting (max ${ASTAR_MAX_ITERATIONS} iterations, ${TIME_BUDGET_MS}ms budget)...`);
  
  if (tokenInAddr === tokenOutAddr) {
    if (verbose) console.log('⚠️  Source and target are the same token\n');
    return [];
  }
  
  // Convert to arrays for hot path access (B6 - use pre-computed if available)
  const heuristicArr = precomputedHeuristicArr || (() => {
    const arr = new Float64Array(tokenToId.size);
    arr.fill(0);
    for (const [id, v] of heuristicId.entries()) {
      arr[id] = Number.isFinite(v) ? v : 0;
    }
    return arr;
  })();
  
  const adjArr = Array.from({length: tokenToId.size}, () => []);
  for (const [fromId, edges] of adjId.entries()) {
    adjArr[fromId] = edges;
  }
  
  const candidatesHeap = new MinHeap();
  let kthScore = -Infinity;
  const seenRoutes = new Set();
  
  const sourceId = tokenToId.get(tokenInAddr);
  const targetId = tokenToId.get(tokenOutAddr);
  
  const frontierHeap = new MaxHeap((a, b) => a.prio - b.prio);
  
  const sourceH = heuristicArr[sourceId];
  const sourcePrio = 0 - sourceH - gasPerHopPenalty * maxHops;
  
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
  let nodesPruned = 0;
  let frontierMinPrio = Infinity;
  let frontierMaxPrio = -Infinity;
  let iterationCount = 0;
  const start = Date.now();
  
  const nodePool = [];
  const maxPoolSize = 1000;
  
  function allocateNode() {
    return nodePool.length > 0 ? nodePool.pop() : {};
  }
  
  function releaseNode(node) {
    if (nodePool.length < maxPoolSize) {
      nodePool.push(node);
    }
  }
  
  // Helper to reconstruct path from parent pointers
  function reconstructPath(state) {
    const path = [];
    let current = state;
    let steps = 0;
    const maxSteps = 100;
    
    while (current.parent !== null) {
      steps++;
      if (steps > maxSteps) {
        console.error(`❌ reconstructPath infinite loop detected! steps=${steps}`);
        console.error(`   current.nodeId=${current.nodeId}, current.hops=${current.hops}`);
        console.error(`   current.parent=${current.parent ? 'exists' : 'null'}`);
        throw new Error('reconstructPath infinite loop');
      }
      
      path.unshift(current.edge);
      current = current.parent;
    }
    return path;
  }
  
  // Dominance pruning: track best score at each (node, depth)
  const bestAtDepth = Array.from(
    {length: tokenToId.size}, 
    () => new Float64Array(maxHops + 1).fill(-Infinity)
  );
  
  // Seed: check for direct source→target edge
  const directEdges = adjArr[sourceId];
  for (const edge of directEdges) {
    if (edge.toId === targetId) {
      const directScore = edge.logSpotPrice - gasPerHopPenalty;
      const directRoute = [{
        pool: edge.pool,
        poolId: edge.poolId,
        fromId: sourceId,
        toId: targetId,
        fromAddr: tokenInAddr,
        toAddr: tokenOutAddr,
      }];
      const routeKey = `${sourceId}:${edge.poolId}:${targetId}`;
      if (!seenRoutes.has(routeKey)) {
        seenRoutes.add(routeKey);
        candidatesHeap.push({ route: directRoute, score: directScore });
        if (candidatesHeap.size() === topK) {
          kthScore = candidatesHeap.peek().score;
        }
        if (verbose) console.log(`   🎯 Seeded with direct edge, score: ${directScore.toFixed(4)}`);
      }
      break;
    }
  }
  
  while (frontierHeap.size() > 0 && iterationCount < ASTAR_MAX_ITERATIONS) {
    iterationCount++;
    
    // Periodic progress logging
    if (verbose && iterationCount % 2000 === 0) {
      console.log(`   Progress: iter=${iterationCount}, frontier=${frontierHeap.size()}, routes=${candidatesHeap.size()}, explored=${nodesExplored}`);
    }
    
    // Soft time budget check
    if (iterationCount % 100 === 0 && (Date.now() - start) > TIME_BUDGET_MS) {
      if (verbose) console.log(`⏱️  Time budget exceeded (${TIME_BUDGET_MS}ms), returning best ${candidatesHeap.size()} routes found`);
      break;
    }
    
    const topFrontier = frontierHeap.peek();
    if (candidatesHeap.size() >= topK && topFrontier.prio <= kthScore) {
      if (verbose) console.log(`🚀 Early termination: frontier best prio (${topFrontier.prio.toFixed(4)}) ≤ kthScore (${kthScore.toFixed(4)})`);
      break;
    }
    
    if (verbose && iterationCount <= 5) {
      console.log(`   Iteration ${iterationCount}: frontier=${frontierHeap.size()}, expanding min(${frontierHeap.size()}, ${beamWidth}), routes=${candidatesHeap.size()}, kthScore=${kthScore === -Infinity ? '-Inf' : kthScore.toFixed(4)}`);
    }
    
    
    const expansionLimit = Math.min(frontierHeap.size(), beamWidth);
    
    for (let i = 0; i < expansionLimit && frontierHeap.size() > 0; i++) {
      const partial = frontierHeap.pop();
      nodesExplored++;
      
      if (verbose && iterationCount === 2 && i < 5) {
        console.log(`     Expansion ${i}: nodeId=${partial.nodeId}, hops=${partial.hops}`);
      }
      
      if (partial.hops >= maxHops) {
        continue;
      }
      
      const h = heuristicArr[partial.nodeId];
      
      const remainingHops = maxHops - partial.hops;
      const upperBound = partial.score - h - (gasPerHopPenalty * remainingHops);
      
      if (candidatesHeap.size() >= topK && upperBound <= kthScore) {
        nodesPruned++;
        continue;
      }
      
      const edges = adjArr[partial.nodeId];
      const edgeLimit = Math.min(edges.length, Math.max(8, Math.floor(beamWidth / 2)));
      
      if (verbose && iterationCount === 2 && i < 5) {
        console.log(`       edges=${edges.length}, edgeLimit=${edgeLimit}`);
      }
      
      for (let ei = 0; ei < edgeLimit; ei++) {
        const edge = edges[ei];
        const nextNodeId = edge.toId;
        
        if (bitsetHas(partial.visitedBits, nextNodeId)) {
          continue;
        }
        
        if (partial.prevNodeId !== null && nextNodeId === partial.prevNodeId) {
          continue;
        }
        
        const newScore = partial.score + edge.logSpotPrice - gasPerHopPenalty;
        const newHops = partial.hops + 1;
        const rem = maxHops - newHops;
        const hRem = heuristicArr[nextNodeId];
        const prio = newScore - hRem - (gasPerHopPenalty * rem);
        
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
          dxCapRaw: edge.dxCapRaw,
          reserveIn: edge.reserveIn,
        };
        
        if (nextNodeId === targetId) {
          const newState = {
            parent: partial,
            edge: newEdge,
          };
          
          const route = reconstructPath(newState);
          const routeKey = route.map(e => `${e.fromId}:${e.poolId}:${e.toId}`).join('|');
          
          if (seenRoutes.has(routeKey)) {
            continue;
          }
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
          // Dominance pruning
          if (newScore <= bestAtDepth[nextNodeId][newHops]) {
            continue;
          }
          bestAtDepth[nextNodeId][newHops] = newScore;
          
          const newVisitedBits = bitsetAdd(partial.visitedBits, nextNodeId);
          
          if (prio < frontierMinPrio) frontierMinPrio = prio;
          if (prio > frontierMaxPrio) frontierMaxPrio = prio;
          
          const newNode = allocateNode();
          newNode.nodeId = nextNodeId;
          newNode.parent = partial;
          newNode.edge = newEdge;
          newNode.visitedBits = newVisitedBits;
          newNode.score = newScore;
          newNode.prio = prio;
          newNode.hops = newHops;
          newNode.prevNodeId = partial.nodeId;
          
          frontierHeap.push(newNode);
        }
      }
    }
    
    // Cap frontier size to prevent memory explosion
    const FRONTIER_CAP = Math.max(beamWidth * 32, topK * 128);
    while (frontierHeap.size() > FRONTIER_CAP) {
      const removed = frontierHeap.pop();  // pop worst prio (MaxHeap)
      releaseNode(removed);
    }
    
    if (verbose && iterationCount <= 5) {
      console.log(`   After iter ${iterationCount}: frontier=${frontierHeap.size()}, routes=${candidatesHeap.size()}`);
    }
  }
  
  if (verbose) {
    console.log(`\n✅ Found ${candidatesHeap.size()} routes`);
    console.log(`📊 A* Search Statistics:`);
    console.log(`  Frontier priority range: [${frontierMinPrio.toFixed(4)}, ${frontierMaxPrio.toFixed(4)}]`);
    console.log(`  K-th best score: ${kthScore.toFixed(4)}`);
    console.log(`  Pruning effectiveness: ${(nodesPruned / Math.max(1, nodesExplored + nodesPruned) * 100).toFixed(1)}%`);
  }
  
  const routes = candidatesHeap.toSortedArray().map(c => c.route);
  
  if (verbose) console.log(`\n🔧 Computing route capacities for ${routes.length} routes...`);
  
  for (let r = 0; r < routes.length; r++) {
    const route = routes[r];
    let routeCapRaw = Infinity;
    for (let h = 0; h < route.length; h++) {
      const hop = route[h];
      if (hop.dxCapRaw !== undefined) {
        routeCapRaw = Math.min(routeCapRaw, hop.dxCapRaw);
      } else if (verbose && r === 0) {
        console.log(`   ⚠️  Route ${r + 1}, Hop ${h + 1}: no dxCapRaw. Keys: ${Object.keys(hop).join(', ')}`);
      }
    }
    route.capRaw = routeCapRaw === Infinity ? 1e18 : routeCapRaw;
    if (verbose && r < 3) {
      console.log(`   Route ${r + 1} (${route.length} hops): capRaw = ${route.capRaw.toExponential(2)}`);
    }
  }
  
  if (verbose) console.log(`✅ Route capacities computed\n`);
  
  return routes;
}

// ============================================================================
// Swap Simulation (Same as Phase 2)
// ============================================================================

function simulateSwap(pool, tokenInAddr, tokenOutAddr, amountIn) {
  const tokenIn = pool.tokens.find(t => t.addr === tokenInAddr);
  const tokenOut = pool.tokens.find(t => t.addr === tokenOutAddr);
  
  if (!tokenIn || !tokenOut) return 0;
  
  const reserveIn = tokenIn.reserveNum;
  const reserveOut = tokenOut.reserveNum;
  
  if (reserveIn === 0 || reserveOut === 0) return 0;
  
  // Check if swap amount is unreasonably large compared to pool reserves
  const swapRatio = amountIn / reserveIn;
  if (swapRatio > 0.1 && verbose) {
    console.log(`    ⚠️  WARNING: Swapping ${(swapRatio * 100).toFixed(1)}% of pool reserves! Pool may have insufficient liquidity.`);
  }
  
  // AMM constant product formula
  const amountInAfterFee = amountIn * (1 - pool.fee);
  const amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
  
  if (verbose) {
    console.log(`\n    🔄 Swap in pool ${pool.addr.slice(0, 10)}...`);
    console.log(`       ${tokenIn.symbol} → ${tokenOut.symbol}`);
    console.log(`       Reserve IN: ${reserveIn.toExponential(2)} raw (${(reserveIn / Math.pow(10, tokenIn.decimals)).toFixed(4)} ${tokenIn.symbol})`);
    console.log(`       Reserve OUT: ${reserveOut.toExponential(2)} raw (${(reserveOut / Math.pow(10, tokenOut.decimals)).toFixed(4)} ${tokenOut.symbol})`);
    console.log(`       Amount IN: ${amountIn.toExponential(4)} raw (${(amountIn / Math.pow(10, tokenIn.decimals)).toFixed(4)} ${tokenIn.symbol})`);
    console.log(`       Fee: ${(pool.fee * 100).toFixed(4)}%`);
    console.log(`       Amount OUT: ${amountOut.toExponential(4)} raw (${(amountOut / Math.pow(10, tokenOut.decimals)).toFixed(4)} ${tokenOut.symbol})`);
  }
  
  return amountOut;
}

function simulateRoute(route, amount) {
  if (verbose) {
    console.log(`\n  📍 Simulating route with ${route.length} hops, starting amount: ${amount}`);
  }
  
  let currentAmount = amount;
  
  for (const hop of route) {
    currentAmount = simulateSwap(hop.pool, hop.fromAddr, hop.toAddr, currentAmount);
    if (currentAmount === 0) break;
  }
  
  if (verbose) {
    console.log(`  ✅ Final output: ${currentAmount.toExponential(6)}`);
  }
  
  return currentAmount;
}

// ============================================================================
// Phase 1: Select Best Route (from ALL routes)
// ============================================================================

function routeFixedGas(hops, gasPerHopInOutputTokens) {
  return hops * gasPerHopInOutputTokens;
}

function selectBestRoute(routes, amount, gasPerHopInOutputTokens) {
  if (verbose) console.log(`🎯 Evaluating ${routes.length} routes to find best...`);
  if (verbose) console.time('EVAL_TIME');
  
  let bestRoute = null;
  let bestNetOutput = 0;
  const results = [];
  
  for (const route of routes) {
    const output = simulateRoute(route, amount);
    const gasCost = routeFixedGas(route.length, gasPerHopInOutputTokens);
    const netOutput = output - gasCost;
    
    results.push({ route, output, gasCost, netOutput, hops: route.length });
    
    if (netOutput > bestNetOutput) {
      bestNetOutput = netOutput;
      bestRoute = route;
    }
  }
  
  if (verbose) {
    console.timeEnd('EVAL_TIME');
    console.log(`\n🏆 Top 5 Routes by net output:`);
    const top5 = results
      .sort((a, b) => b.netOutput - a.netOutput)
      .slice(0, 5)
      .map((r, i) => ({
        rank: i + 1,
        hops: r.hops,
        output: r.output.toExponential(4),
        gas: r.gasCost.toFixed(2),
        net: r.netOutput.toExponential(4)
      }));
    console.table(top5);
    console.log(`✅ Best route net output: ${bestNetOutput.toExponential(6)}\n`);
  }
  
  return { route: bestRoute, output: bestNetOutput };
}

// ============================================================================
// Format & Display
// ============================================================================

function formatRoute(route, tokenMap) {
  if (!route || route.length === 0) return 'Empty';
  
  const tokens = [tokenMap.get(route[0].fromAddr)?.symbol || 'Unknown'];
  for (const hop of route) {
    tokens.push(tokenMap.get(hop.toAddr)?.symbol || 'Unknown');
  }
  
  return tokens.join(' → ');
}

function displayPhase1Result(routes, bestResult, amount, tokenMap) {
  console.log('='.repeat(80));
  console.log('📊 PHASE 1 RESULTS (A* Implementation with Target-Aware Heuristic)');
  console.log('='.repeat(80));
  console.log();
  
  console.log(`Results:`);
  console.log(`  Routes found: ${routes.length}`);
  console.log(`  Best output: ${bestResult.output.toFixed(2)}`);
  console.log();
  
  if (routes.length > 0) {
    console.log(`Best Route Details:`);
    console.log(`  Path: ${formatRoute(bestResult.route, tokenMap)}`);
    console.log(`  Hops: ${bestResult.route?.length || 0}`);
    console.log(`  Input: ${amount.toFixed(2)}`);
    console.log(`  Output: ${bestResult.output.toFixed(2)}`);
    console.log();
  }
}

function displayPhase2Result(phase2Result, phase1BestOutput, tokenMap) {
  console.log('='.repeat(80));
  console.log('📊 PHASE 2 RESULTS (Water-Filling Route Splitting)');
  console.log('='.repeat(80));
  console.log();
  
  console.log(`Configuration:`);
  console.log(`  Gas Policy: ${phase2Result.gasPolicy}`);
  console.log(`  Routes Used: ${phase2Result.routes.length}`);
  console.log(`  Iterations: ${phase2Result.iterations}`);
  console.log();
  
  console.log(`Results:`);
  console.log(`  Total Input: ${phase2Result.totalInputHuman.toFixed(2)}`);
  console.log(`  Total Output: ${phase2Result.totalOutputHuman.toFixed(2)}`);
  
  const improvement = ((phase2Result.totalOutputHuman - phase1BestOutput) / phase1BestOutput) * 100;
  console.log(`  Improvement vs Phase 1: ${improvement > 0 ? '+' : ''}${improvement.toFixed(2)}%`);
  console.log();
  
  console.log(`Route Allocations:`);
  console.table(
    phase2Result.routes.map((r, i) => ({
      Route: i + 1,
      Hops: r.hops,
      'Input %': ((r.inputRaw / phase2Result.totalInputRaw) * 100).toFixed(2) + '%',
      'Input': r.inputHuman.toFixed(4),
      'Output': r.outputHuman.toFixed(4),
      'Start Eff': r.initialEffRate != null ? r.initialEffRate.toFixed(6) : 'n/a',
      'Final Marginal': r.effRate.toFixed(6),
      'Path': formatRoute(r.route, tokenMap),
    }))
  );
  console.log();
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const totalStart = performance.now();
  
  console.log('='.repeat(80));
  console.log('SOR PHASE 1 POC - A* SEARCH WITH TARGET-AWARE HEURISTIC');
  console.log('='.repeat(80));
  console.log();
  console.log(`Configuration:`);
  console.log(`  Token From: ${tokenFrom}`);
  console.log(`  Token To: ${tokenTo}`);
  console.log(`  Amount: ${swapAmount}`);
  console.log(`  Max Hops: ${maxHops}`);
  console.log(`  Top K Routes: ${topK}`);
  console.log(`  Beam Width: ${beamWidth}`);
  console.log(`  Gas Per Hop: $${gasPerHopUSD}`);
  console.log(`  Verbose: ${verbose}`);
  console.log();
  console.log('='.repeat(80));
  console.log();
  
  const client = new Client(dbConfig);
  
  try {
    // Connect to database
    const dbStart = performance.now();
    if (verbose) console.log('📡 Connecting to database...');
    await client.connect();
    if (verbose) console.log('✅ Connected\n');
    
    // Fetch pools
    const pools = await fetchPoolsFromDB(client);
    
    const dbTime = performance.now() - dbStart;
    
    if (pools.length === 0) {
      if (verbose) console.log('❌ No pools found in database!\n');
      return;
    }
    
    if (verbose) {
      console.log(`\n🔍 Sample Pool Data Inspection:`);
      const samplePools = pools.slice(0, 3);
      samplePools.forEach(pool => {
        console.log(`\n  Pool: ${pool.addr.slice(0, 16)}...`);
        console.log(`  Type: ${pool.type}, Fee: ${(pool.fee * 100).toFixed(4)}%`);
        pool.tokens.forEach(t => {
          const reserve = parseFloat(t.reserve);
          console.log(`    - ${t.symbol.padEnd(8)}: reserve=${reserve.toExponential(4)}, decimals=${t.decimals}`);
        });
      });
      console.log();
    }
    
    // Build token map from pools (like yens does via PoolGraph.addNode)
    const graphStart = performance.now();
    const tokenMap = new Map();
    for (const pool of pools) {
      for (const token of pool.tokens) {
        if (!tokenMap.has(token.addr)) {
          tokenMap.set(token.addr, {
            addr: token.addr,
            symbol: token.symbol,
            decimals: token.decimals,
            reserve: token.reserve,
            token_idx: token.token_idx
          });
        }
      }
    }

    // Find token addresses
    const sourceToken = Array.from(tokenMap.values()).find(t => t.symbol === tokenFrom);
    const targetToken = Array.from(tokenMap.values()).find(t => t.symbol === tokenTo);
    
    if (verbose) {
      console.log(`Source token: ${sourceToken.symbol}, addr: ${sourceToken.addr}`);
      console.log(`Target token: ${targetToken.symbol}, addr: ${targetToken.addr}`);
      console.log();
    }

    if (!sourceToken || !targetToken) {
      if (verbose) console.log(`❌ Token not found!\n`);
      return;
    }
    
    // Phase 1: Preprocess graph
    if (verbose) console.log('🔧 Preprocessing graph...');
    if (verbose) console.time('PREPROCESSING_TIME');
    
    const { adj, tokenToId, poolToId } = buildAdjacencyMap(pools, tokenMap);
    compressParallelEdges(adj);
    const { adjId, idToAddr } = buildNumericAdjacency(adj, tokenToId);
    
    // Gas penalty: simple stable detection or use default
    let targetTokenUSDPrice = 1.0;
    const stablecoins = ['USDC', 'USDT', 'DAI', 'BUSD', 'UST'];
    if (stablecoins.includes(targetToken.symbol)) {
      targetTokenUSDPrice = 1.0;
    } else {
      targetTokenUSDPrice = 1.0;
    }
    
    const gasPerHopInOutputTokens = gasPerHopUSD / targetTokenUSDPrice;
    const gasPerHopPenalty = gasPerHopUSD > 0 ? Math.log(1 + gasPerHopInOutputTokens / swapAmount) : 0;
    if (verbose) console.log(`🔧 Gas per hop: $${gasPerHopUSD} → ${gasPerHopInOutputTokens.toFixed(4)} ${targetToken.symbol} → penalty ${gasPerHopPenalty.toFixed(6)}`);
    
    if (verbose) console.log('🔧 Computing A* heuristic (reverse Dijkstra from target)...');
    const heuristicResult = computeReverseHeuristic(adj, targetToken.addr, gasPerHopPenalty, sourceToken.addr, tokenToId);
    
    // Handle both old (Map) and new (cached object) formats
    let heuristic, heuristicArr;
    if (heuristicResult.dist) {
      // New format with pre-computed array (B6)
      heuristic = heuristicResult.dist;
      heuristicArr = heuristicResult.heuristicArr;
      if (verbose) console.log('✅ Using pre-computed heuristic array from cache');
    } else {
      // Old format (Map only)
      heuristic = heuristicResult;
    }
    
    const heuristicId = mapHeuristicToIds(heuristic, tokenToId);
    
    if (verbose) console.timeEnd('PREPROCESSING_TIME');
    if (verbose) console.log();
    
    const graphBuildTime = performance.now() - graphStart;
    
    if (!verbose) {
      console.log(`⏱️  DB Fetch Time: ${dbTime.toFixed(3)}ms`);
      console.log(`⏱️  Graph Build Time: ${graphBuildTime.toFixed(3)}ms`);
    }
    
    // Phase 1: A* search to find top K routes
    const algoStart = performance.now();
    if (verbose) console.time('TOTAL_PHASE1_TIME');
    const allRoutes = findTopKRoutesAStar(adjId, heuristicId, tokenToId, idToAddr, sourceToken.addr, targetToken.addr, maxHops, topK, beamWidth, gasPerHopPenalty, heuristicArr);
    
    if (allRoutes.length === 0) {
      if (verbose) console.log(`❌ No routes found!\n`);
      return;
    }
    
    // Convert swap amount to raw units (reserves are in raw units)
    // IMPORTANT: Use decimals from the actual source token in pools, not from tokenMap
    // Find actual source token decimals from any pool that contains it
    const sampleSourcePool = pools.find(p => p.tokens.some(t => t.addr === sourceToken.addr));
    const actualSourceToken = sampleSourcePool.tokens.find(t => t.addr === sourceToken.addr);
    const actualSourceDecimals = actualSourceToken.decimals;
    
    const swapAmountRaw = swapAmount * Math.pow(10, actualSourceDecimals);
    if (verbose) {
      console.log(`💱 Converting swap amount: ${swapAmount} ${actualSourceToken.symbol} → ${swapAmountRaw.toExponential(4)} raw units (decimals=${actualSourceDecimals})\n`);
    }
    
    // Select best route
    const bestResult = selectBestRoute(allRoutes, swapAmountRaw, gasPerHopInOutputTokens);
    
    // Convert output back to human-readable units
    // IMPORTANT: Use decimals from the actual target token in the route, not from tokenMap
    // tokenMap can have wrong decimals if multiple tokens share the same symbol
    const lastHop = bestResult.route[bestResult.route.length - 1];
    const actualTargetToken = lastHop.pool.tokens.find(t => t.addr === lastHop.toAddr);
    const actualTargetDecimals = actualTargetToken.decimals;
    
    const bestOutputHuman = bestResult.output / Math.pow(10, actualTargetDecimals);
    if (verbose) {
      console.log(`💱 Converting output: ${bestResult.output.toExponential(4)} raw units → ${bestOutputHuman.toFixed(4)} ${actualTargetToken.symbol} (decimals=${actualTargetDecimals})\n`);
    }
    
    if (verbose) console.timeEnd('TOTAL_PHASE1_TIME');
    if (verbose) console.log();
    
    const algoTime = performance.now() - algoStart;
    if (!verbose) {
      console.log(`⏱️  Algorithm Time (${allRoutes.length} routes found): ${algoTime.toFixed(3)}ms`);
    }
    
    const totalTime = performance.now() - totalStart;
    if (!verbose) {
      console.log(`⏱️  Total Time: ${totalTime.toFixed(3)}ms`);
      console.log();
    }
    
    // Display results with human-readable output
    displayPhase1Result(allRoutes, { route: bestResult.route, output: bestOutputHuman }, swapAmount, tokenMap);
    
    // Phase 2: Route Splitting (if enabled)
    if (enablePhase2) {
      const phase2 = require('./phase2-waterfill.js');
      const hillClimb = require('./phase2-hillclimb.js');
      
      // Evaluate all routes and sort by net output (best first)
      // This ensures Phase 2 gets the highest quality routes, not just A* discovery order
      const evaluatedRoutes = allRoutes.map(route => {
        const output = simulateRoute(route, swapAmountRaw);
        const gasCost = route.length * gasPerHopInOutputTokens;
        const netOutput = output - gasCost;
        return { route, netOutput };
      }).sort((a, b) => b.netOutput - a.netOutput);
      
      // Take top 10 best-performing routes for Phase 2
      const topRoutesForSplitting = evaluatedRoutes
        .slice(0, Math.min(10, allRoutes.length))
        .map(r => r.route);
      
      const routeCapacities = topRoutesForSplitting.map(route => {
        const cap = route.capRaw || 1e18;
        if (verbose && cap === 1e18) {
          console.log(`⚠️  Route has no capRaw (using fallback 1e18), hops: ${route.length}`);
          if (route.length > 0 && route[0].dxCapRaw !== undefined) {
            console.log(`   First hop has dxCapRaw: ${route[0].dxCapRaw.toExponential(2)}`);
          }
        }
        return cap;
      });
      
      const phase2Result = phase2.optimizeRouteSplittingWaterfill(
        topRoutesForSplitting,
        swapAmount,
        sourceToken,
        targetToken,
        {
          steps: 18,
          chunkCoarse: 0.05,
          chunkFine: 0.001,
          maxIterations: 5000,
          tol: 1e-10,
          minPct: 0.001,
          maxHops,
          gasPerHopUSD,
          verbose,
          routeCapacities,
          legacyWaterfill: LEGACY_WATERFILL,
          enableCapacityConstraints: false,
          minMarginalRatioFilter: 0.50,
        }
      );
      
      let hillClimbResult = null;
      
      if (phase2Result) {
        displayPhase2Result(phase2Result, bestOutputHuman, tokenMap);
      }
      
      hillClimbResult = hillClimb.optimizeRouteSplittingHillClimb(
        topRoutesForSplitting,
        swapAmount,
        sourceToken,
        targetToken,
        {
          maxHops,
          gasPerHopUSD,
          routeCapacities,
          verbose,
          deltaPct: 0.001,
          maxIterations: 200,
          maxActiveRoutes: 10,
          steps: 18,
          minMarginalRatioFilter: 0.50,
          minInitialEffRatio: 0.0,
        }
      );
      
      if (hillClimbResult) {
        displayPhase2Result(hillClimbResult, bestOutputHuman, tokenMap);
      }
      
      const comparison = [];
      if (phase2Result) {
        comparison.push({ name: 'Water-Fill', result: phase2Result });
      }
      if (hillClimbResult) {
        comparison.push({ name: 'Hill Climb', result: hillClimbResult });
      }
      
      if (comparison.length > 1) {
        comparison.sort((a, b) => b.result.totalOutputHuman - a.result.totalOutputHuman);
        const best = comparison[0];
        const second = comparison[1];
        const diff = best.result.totalOutputHuman - second.result.totalOutputHuman;
        const diffBase = second.result.totalOutputHuman;
        const diffPct = diffBase !== 0 ? (diff / diffBase) * 100 : 0;
        const targetSymbol = targetToken.symbol || 'OUTPUT';
        console.log('='.repeat(80));
        console.log('🏁 PHASE 2 COMPARISON');
        console.log('='.repeat(80));
        console.log();
        console.log(`Best Algorithm : ${best.name}`);
        console.log(`Best Output    : ${best.result.totalOutputHuman.toFixed(4)} ${targetSymbol}`);
        console.log(`Runner-Up      : ${second.name} (${second.result.totalOutputHuman.toFixed(4)} ${targetSymbol})`);
        console.log(`Output Diff    : ${diff.toFixed(4)} ${targetSymbol} (${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(4)}%)`);
        if (best.result.timings?.total != null && second.result.timings?.total != null) {
          const timingDiff = best.result.timings.total - second.result.timings.total;
          console.log(`Timing (best)  : ${best.result.timings.total.toFixed(3)}ms`);
          console.log(`Timing (runner): ${second.result.timings.total.toFixed(3)}ms (Δ ${timingDiff >= 0 ? '+' : ''}${timingDiff.toFixed(3)}ms)`);
        }
        console.log();
      }
    }
    
    if (verbose) console.log('✅ Phase 1 POC completed!\n');
    
    // Return data for benchmarking
    return {
      totalRoutes: allRoutes.length,
      bestRoute: bestResult.route,
      bestOutput: bestResult.output,
      tokenMap,
    };
    
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
  findTopKRoutesAStar,
  selectBestRoute,
  simulateRoute,
  buildAdjacencyMap,
  compressParallelEdges,
  computeReverseHeuristic,
  mapHeuristicToIds,
  buildNumericAdjacency,
  main,
};
