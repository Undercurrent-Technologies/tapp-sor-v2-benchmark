#!/usr/bin/env node

/**
 * SOR Phase 1 POC - DFS Algorithm (Current Implementation)
 * 
 * Simulates the CURRENT backend implementation for comparison with Phase 2.
 * 
 * Phase 1 Approach:
 * 1. DFS to find ALL routes (exhaustive search)
 * 2. Single best route selection
 * 3. Max 2 hops limit
 * 4. Chunking for order book generation
 * 
 * Usage:
 *   node phase1-dfs-poc.js APT USDC 10000
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
const maxHops = parseInt(args.find(a => a.startsWith('--max-hops='))?.split('=')[1] || '2'); // Phase 1 default: 2
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
}

// ============================================================================
// Database Queries (Same as Phase 2)
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
// Phase 1 DFS Algorithm (Find ALL Routes)
// ============================================================================

function findAllRoutesDFS(pools, tokenInAddr, tokenOutAddr, maxHops) {
  console.log(`🔍 Phase 1 DFS: Finding ALL routes (max ${maxHops} hops)...`);
  console.time('DFS_TIME');
  
  const allRoutes = [];
  const visited = new Set();
  
  function dfs(currentToken, targetToken, path, hopCount) {
    // Max hops reached
    if (hopCount > maxHops) {
      return;
    }
    
    // Found target!
    if (currentToken === targetToken && path.length > 0) {
      allRoutes.push([...path]);
      return;
    }
    
    // Explore all pools that have current token
    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];
      
      if (!pool.hasToken(currentToken)) continue;
      
      // Get the other token in this pool
      const otherToken = pool.getOtherToken(currentToken);
      if (!otherToken) continue;
      
      // Skip if already visited this pool in current path
      const poolKey = `${pool.addr}-${currentToken}-${otherToken.addr}`;
      if (visited.has(poolKey)) continue;
      
      // Add to path and explore
      visited.add(poolKey);
      path.push({
        pool,
        from: currentToken,
        to: otherToken.addr,
      });
      
      dfs(otherToken.addr, targetToken, path, hopCount + 1);
      
      // Backtrack
      path.pop();
      visited.delete(poolKey);
    }
  }
  
  dfs(tokenInAddr, tokenOutAddr, [], 0);
  
  console.timeEnd('DFS_TIME');
  console.log(`✅ Found ${allRoutes.length} routes\n`);
  
  return allRoutes;
}

// ============================================================================
// Swap Simulation (Same as Phase 2)
// ============================================================================

function simulateSwap(pool, tokenInAddr, tokenOutAddr, amountIn) {
  const tokenIn = pool.tokens.find(t => t.addr === tokenInAddr);
  const tokenOut = pool.tokens.find(t => t.addr === tokenOutAddr);
  
  if (!tokenIn || !tokenOut) return 0;
  
  const reserveIn = parseFloat(tokenIn.reserve);
  const reserveOut = parseFloat(tokenOut.reserve);
  
  if (reserveIn === 0 || reserveOut === 0) return 0;
  
  // AMM constant product formula
  const amountInAfterFee = amountIn * (1 - pool.fee);
  const amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
  
  return amountOut;
}

function simulateRoute(route, amount) {
  let currentAmount = amount;
  
  for (const hop of route) {
    currentAmount = simulateSwap(hop.pool, hop.from, hop.to, currentAmount);
    if (currentAmount === 0) break;
  }
  
  return currentAmount;
}

// ============================================================================
// Phase 1: Select Best Route (from ALL routes)
// ============================================================================

function selectBestRoute(routes, amount) {
  console.log(`🎯 Evaluating ${routes.length} routes to find best...`);
  console.time('EVAL_TIME');
  
  let bestRoute = null;
  let bestOutput = 0;
  
  for (const route of routes) {
    const output = simulateRoute(route, amount);
    
    if (output > bestOutput) {
      bestOutput = output;
      bestRoute = route;
    }
  }
  
  console.timeEnd('EVAL_TIME');
  console.log(`✅ Best route output: ${bestOutput.toFixed(2)}\n`);
  
  return { route: bestRoute, output: bestOutput };
}

// ============================================================================
// Format & Display
// ============================================================================

function formatRoute(route, tokenMap) {
  if (!route || route.length === 0) return 'Empty';
  
  const tokens = [tokenMap.get(route[0].from)?.symbol || 'Unknown'];
  for (const hop of route) {
    tokens.push(tokenMap.get(hop.to)?.symbol || 'Unknown');
  }
  
  return tokens.join(' → ');
}

function displayPhase1Result(routes, bestResult, amount, tokenMap) {
  console.log('='.repeat(80));
  console.log('📊 PHASE 1 RESULTS (Current Implementation)');
  console.log('='.repeat(80));
  console.log();
  
  console.log(`Total routes found: ${routes.length}`);
  console.log(`Routes by hop count:`);
  
  const hopCounts = {};
  for (const route of routes) {
    const hops = route.length;
    hopCounts[hops] = (hopCounts[hops] || 0) + 1;
  }
  
  for (const [hops, count] of Object.entries(hopCounts).sort()) {
    console.log(`  ${hops} hop${hops > 1 ? 's' : ''}: ${count} routes`);
  }
  console.log();
  
  console.log(`Best Route:`);
  console.log(`  Path: ${formatRoute(bestResult.route, tokenMap)}`);
  console.log(`  Hops: ${bestResult.route?.length || 0}`);
  console.log(`  Input: ${amount.toFixed(2)}`);
  console.log(`  Output: ${bestResult.output.toFixed(2)}`);
  
  const priceImpact = ((amount - bestResult.output) / amount) * 100;
  console.log(`  Price Impact: ${priceImpact.toFixed(2)}%`);
  console.log();
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('SOR PHASE 1 POC - DFS ALGORITHM (Current Implementation)');
  console.log('='.repeat(80));
  console.log();
  console.log(`Configuration:`);
  console.log(`  Token From: ${tokenFrom}`);
  console.log(`  Token To: ${tokenTo}`);
  console.log(`  Amount: ${swapAmount}`);
  console.log(`  Max Hops: ${maxHops} (Phase 1 default: 2)`);
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
    
    // Fetch pools and tokens
    const pools = await fetchPoolsFromDB(client);
    const tokenMap = await getTokenMap(client);
    
    if (pools.length === 0) {
      console.log('❌ No pools found in database!\n');
      return;
    }
    
    // Find token addresses
    const sourceToken = Array.from(tokenMap.values()).find(t => t.symbol === tokenFrom);
    const targetToken = Array.from(tokenMap.values()).find(t => t.symbol === tokenTo);
    
    if (!sourceToken || !targetToken) {
      console.log(`❌ Token not found!\n`);
      return;
    }
    
    // Phase 1: DFS to find ALL routes
    console.time('TOTAL_PHASE1_TIME');
    const allRoutes = findAllRoutesDFS(pools, sourceToken.addr, targetToken.addr, maxHops);
    
    if (allRoutes.length === 0) {
      console.log(`❌ No routes found!\n`);
      return;
    }
    
    // Select best route
    const bestResult = selectBestRoute(allRoutes, swapAmount);
    console.timeEnd('TOTAL_PHASE1_TIME');
    console.log();
    
    // Display results
    displayPhase1Result(allRoutes, bestResult, swapAmount, tokenMap);
    
    console.log('✅ Phase 1 POC completed!\n');
    
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
  findAllRoutesDFS,
  selectBestRoute,
  simulateRoute,
  main,
};

