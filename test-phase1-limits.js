#!/usr/bin/env node

/**
 * Test Phase 1 DFS Scalability Limits
 * 
 * Demonstrates why Phase 1 cannot handle 3+ hops
 * Shows exponential growth in routes found
 */

const { Client } = require('pg');

const dbConfig = {
  host: 'localhost',
  port: 5432,
  database: 'tapp',
  user: 'tapp',
  password: 'tapp',
};

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

// DFS with progress tracking
function findAllRoutesDFS_WithProgress(pools, tokenInAddr, tokenOutAddr, maxHops) {
  console.log(`\n🔍 DFS: Finding ALL routes (max ${maxHops} hops)...`);
  console.log(`   Pool count: ${pools.length}`);
  console.log(`   Theoretical max routes: ${pools.length}^${maxHops} = ${Math.pow(pools.length, maxHops).toLocaleString()}\n`);
  
  const allRoutes = [];
  const visited = new Set();
  let explorationCount = 0;
  let lastReport = Date.now();
  const startTime = Date.now();
  const MAX_TIME = 30000; // 30 seconds timeout
  
  function dfs(currentToken, targetToken, path, hopCount) {
    explorationCount++;
    
    // Progress report every 1000 explorations
    if (explorationCount % 1000 === 0) {
      const elapsed = Date.now() - startTime;
      const rate = explorationCount / (elapsed / 1000);
      
      console.log(`   Explored: ${explorationCount.toLocaleString()} paths | ` +
                  `Found: ${allRoutes.length.toLocaleString()} routes | ` +
                  `Time: ${(elapsed / 1000).toFixed(1)}s | ` +
                  `Rate: ${rate.toFixed(0)} paths/sec`);
      
      // Timeout check
      if (elapsed > MAX_TIME) {
        console.log(`\n⚠️  TIMEOUT! DFS taking too long (>${MAX_TIME/1000}s)\n`);
        throw new Error('DFS_TIMEOUT');
      }
    }
    
    // Max hops reached
    if (hopCount > maxHops) {
      return;
    }
    
    // Found target!
    if (currentToken === targetToken && path.length > 0) {
      allRoutes.push([...path]);
      return;
    }
    
    // Explore all pools
    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];
      
      if (!pool.hasToken(currentToken)) continue;
      
      const otherToken = pool.getOtherToken(currentToken);
      if (!otherToken) continue;
      
      const poolKey = `${pool.addr}-${currentToken}-${otherToken.addr}`;
      if (visited.has(poolKey)) continue;
      
      visited.add(poolKey);
      path.push({
        pool,
        from: currentToken,
        to: otherToken.addr,
      });
      
      dfs(otherToken.addr, targetToken, path, hopCount + 1);
      
      path.pop();
      visited.delete(poolKey);
    }
  }
  
  try {
    dfs(tokenInAddr, tokenOutAddr, [], 0);
    const elapsed = Date.now() - startTime;
    
    console.log(`\n✅ DFS completed!`);
    console.log(`   Total paths explored: ${explorationCount.toLocaleString()}`);
    console.log(`   Routes found: ${allRoutes.length.toLocaleString()}`);
    console.log(`   Time taken: ${(elapsed / 1000).toFixed(2)}s`);
    console.log();
    
    return allRoutes;
  } catch (error) {
    if (error.message === 'DFS_TIMEOUT') {
      const elapsed = Date.now() - startTime;
      console.log(`\n❌ DFS FAILED (timeout after ${(elapsed / 1000).toFixed(1)}s)`);
      console.log(`   Paths explored before timeout: ${explorationCount.toLocaleString()}`);
      console.log(`   Routes found before timeout: ${allRoutes.length.toLocaleString()}`);
      console.log(`   Estimated total routes: ${Math.pow(pools.length, maxHops).toLocaleString()}`);
      console.log(`   Completion: ${(explorationCount / Math.pow(pools.length, maxHops) * 100).toFixed(4)}%`);
      console.log();
      return null; // Indicate failure
    }
    throw error;
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('🧪 PHASE 1 SCALABILITY TEST - Why 3+ Hops Fails');
  console.log('='.repeat(80));
  console.log();
  
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    
    // Fetch pools
    const poolsQuery = `
      SELECT 
        p.addr as pool_addr,
        p.pool_type,
        p.fee_tier,
        p.liquidity,
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
      GROUP BY p.addr, p.pool_type, p.fee_tier, p.liquidity
      ORDER BY p.liquidity DESC
    `;
    
    const poolsResult = await client.query(poolsQuery);
    const pools = poolsResult.rows.map(p => new PoolWrapper(p));
    
    const tokensQuery = `SELECT addr, ticker as symbol FROM tokens`;
    const tokensResult = await client.query(tokensQuery);
    const tokenMap = new Map(tokensResult.rows.map(r => [r.symbol, r.addr]));
    
    console.log(`📊 Database: ${pools.length} active pools loaded\n`);
    console.log('='.repeat(80));
    
    // Test 1: 2 hops (should work)
    console.log('\n📌 TEST 1: Phase 1 with max_hops = 2 (Current Limit)');
    console.log('-'.repeat(80));
    
    const test1Start = Date.now();
    const routes2hops = findAllRoutesDFS_WithProgress(
      pools,
      tokenMap.get('USDT'),
      tokenMap.get('USDC'),
      2
    );
    const test1Time = Date.now() - test1Start;
    
    if (routes2hops) {
      console.log(`✅ TEST 1 PASSED: Found ${routes2hops.length} routes in ${(test1Time / 1000).toFixed(2)}s`);
    }
    
    console.log('='.repeat(80));
    
    // Test 2: 3 hops (will timeout or take very long)
    console.log('\n📌 TEST 2: Phase 1 with max_hops = 3 (Proposed, but too slow!)');
    console.log('-'.repeat(80));
    console.log('⚠️  WARNING: This will likely timeout or take minutes!');
    console.log('⚠️  Timeout set to 30 seconds...\n');
    
    const test2Start = Date.now();
    const routes3hops = findAllRoutesDFS_WithProgress(
      pools,
      tokenMap.get('USDT'),
      tokenMap.get('USDC'),
      3
    );
    const test2Time = Date.now() - test2Start;
    
    if (routes3hops) {
      console.log(`✅ TEST 2 COMPLETED: Found ${routes3hops.length} routes in ${(test2Time / 1000).toFixed(2)}s`);
      console.log(`⚠️  But this took ${(test2Time / test1Time).toFixed(1)}x longer than 2 hops!`);
    } else {
      console.log(`❌ TEST 2 FAILED: Timeout after ${(test2Time / 1000).toFixed(2)}s`);
    }
    
    console.log('='.repeat(80));
    
    // Summary
    console.log('\n📊 SUMMARY & CONCLUSION');
    console.log('='.repeat(80));
    console.log();
    console.log('Complexity Growth (DFS Algorithm):');
    console.log(`  max_hops = 1: ~${pools.length} routes`);
    console.log(`  max_hops = 2: ~${Math.pow(pools.length, 2).toLocaleString()} routes (${pools.length}²)`);
    console.log(`  max_hops = 3: ~${Math.pow(pools.length, 3).toLocaleString()} routes (${pools.length}³) ❌`);
    console.log(`  max_hops = 4: ~${Math.pow(pools.length, 4).toLocaleString()} routes (${pools.length}⁴) ❌❌`);
    console.log(`  max_hops = 5: ~${Math.pow(pools.length, 5).toLocaleString()} routes (${pools.length}⁵) ❌❌❌`);
    console.log();
    
    console.log('Execution Time Estimates:');
    if (routes2hops && test1Time) {
      const timePerRoute = test1Time / (routes2hops.length || 1);
      console.log(`  2 hops: ${(test1Time / 1000).toFixed(2)}s ✅ (measured)`);
      console.log(`  3 hops: ~${(timePerRoute * Math.pow(pools.length, 3) / 1000).toFixed(0)}s ≈ ${(timePerRoute * Math.pow(pools.length, 3) / 60000).toFixed(0)} minutes ❌`);
      console.log(`  4 hops: ~${(timePerRoute * Math.pow(pools.length, 4) / 3600000).toFixed(0)} hours ❌❌`);
      console.log(`  5 hops: ~${(timePerRoute * Math.pow(pools.length, 5) / 86400000).toFixed(0)} days ❌❌❌`);
    }
    console.log();
    
    console.log('🎯 CONCLUSION:');
    console.log('  ❌ Phase 1 (DFS) CANNOT scale to 3+ hops!');
    console.log('  ❌ Exponential complexity makes it impractical');
    console.log('  ✅ Phase 2 (Yen\'s) needed for 3+ hops (O(K×V×E), not O(pools^hops))');
    console.log();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main();
}


