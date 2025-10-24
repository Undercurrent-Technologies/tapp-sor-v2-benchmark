#!/usr/bin/env node

/**
 * Analyze Real Pool Data
 * 
 * Queries the database to find:
 * 1. Most common token pairs
 * 2. Tokens with most connections (good for multi-hop routing)
 * 3. Suggested token pairs to test Yen's algorithm
 * 
 * Usage:
 *   node analyze-pools.js
 */

const { Client } = require('pg');

const dbConfig = {
  host: 'localhost',
  port: 5432,
  database: 'tapp',
  user: 'tapp',
  password: 'tapp',
};

async function main() {
  console.log('🔍 Analyzing real pool data from database...\n');
  
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('✅ Connected to database\n');
    
    // 1. Get total pool stats
    console.log('📊 Pool Statistics');
    console.log('='.repeat(80));
    
    const poolStats = await client.query(`
      SELECT 
        COUNT(*) as total_pools,
        COUNT(DISTINCT CASE WHEN status = 'ACTIVE' THEN addr END) as active_pools,
        pool_type,
        COUNT(*) as count_by_type
      FROM pools
      GROUP BY pool_type
      ORDER BY count_by_type DESC
    `);
    
    const totalActive = await client.query(`
      SELECT COUNT(*) as total FROM pools WHERE status = 'ACTIVE'
    `);
    
    console.log(`Total active pools: ${totalActive.rows[0].total}`);
    console.log('\nPools by type:');
    for (const row of poolStats.rows) {
      console.log(`  ${row.pool_type}: ${row.count_by_type} pools`);
    }
    console.log();
    
    // 2. Get token connectivity (how many pools each token appears in)
    console.log('🌐 Token Connectivity (Top 20)');
    console.log('='.repeat(80));
    
    const tokenConnectivity = await client.query(`
      SELECT 
        t.ticker as symbol,
        t.addr,
        COUNT(DISTINCT ptm.pool_id) as pool_count,
        SUM(CAST(ptm.reserve AS NUMERIC)) as total_reserve
      FROM tokens t
      JOIN pool_token_mps ptm ON t.addr = ptm.token_addr
      JOIN pools p ON ptm.pool_id = p.addr
      WHERE p.status = 'ACTIVE'
      GROUP BY t.ticker, t.addr
      ORDER BY pool_count DESC, total_reserve DESC
      LIMIT 20
    `);
    
    console.log('Token | Pools | Total Reserve');
    console.log('-'.repeat(50));
    for (const row of tokenConnectivity.rows) {
      console.log(`${row.symbol.padEnd(10)} | ${String(row.pool_count).padStart(5)} | ${row.total_reserve || 'N/A'}`);
    }
    console.log();
    
    // 3. Find token pairs with multiple routes (good for testing)
    console.log('🔀 Token Pairs with Multiple Pool Options');
    console.log('='.repeat(80));
    
    const tokenPairs = await client.query(`
      WITH token_pairs AS (
        SELECT 
          p.addr as pool_addr,
          t1.ticker as token0,
          t2.ticker as token1,
          t1.addr as token0_addr,
          t2.addr as token1_addr,
          p.pool_type,
          p.fee_tier,
          CAST(p.liquidity AS NUMERIC) as liquidity
        FROM pools p
        JOIN pool_token_mps ptm1 ON p.addr = ptm1.pool_id AND ptm1.token_idx = 0
        JOIN pool_token_mps ptm2 ON p.addr = ptm2.pool_id AND ptm2.token_idx = 1
        JOIN tokens t1 ON ptm1.token_addr = t1.addr
        JOIN tokens t2 ON ptm2.token_addr = t2.addr
        WHERE p.status = 'ACTIVE'
      )
      SELECT 
        token0,
        token1,
        COUNT(*) as pool_count,
        array_agg(DISTINCT pool_type) as pool_types,
        SUM(liquidity) as total_liquidity
      FROM token_pairs
      GROUP BY token0, token1
      HAVING COUNT(*) > 1
      ORDER BY pool_count DESC, total_liquidity DESC
      LIMIT 15
    `);
    
    console.log('Pair            | Pools | Types                  | Total Liquidity');
    console.log('-'.repeat(80));
    for (const row of tokenPairs.rows) {
      const pair = `${row.token0}-${row.token1}`.padEnd(15);
      const types = row.pool_types.join(', ').substring(0, 20).padEnd(20);
      console.log(`${pair} | ${String(row.pool_count).padStart(5)} | ${types} | ${row.total_liquidity || 'N/A'}`);
    }
    console.log();
    
    // 4. Suggest best token pairs for testing
    console.log('💡 Recommended Token Pairs for Testing Yen\'s Algorithm');
    console.log('='.repeat(80));
    
    // Find tokens that appear in many pools (high connectivity)
    const highConnectivity = tokenConnectivity.rows.slice(0, 5);
    
    console.log('\nTop connected tokens (best for multi-hop routing):');
    for (const row of highConnectivity) {
      console.log(`  ${row.symbol} (${row.pool_count} pools)`);
    }
    console.log();
    
    // Suggest test pairs
    if (highConnectivity.length >= 2) {
      const token1 = highConnectivity[0].symbol;
      const token2 = highConnectivity[1].symbol;
      
      console.log('Suggested test commands:');
      console.log();
      console.log(`1. Most connected pair:`);
      console.log(`   node yens-algorithm-poc.js ${token1} ${token2} 10000 --k=5`);
      console.log();
      
      if (highConnectivity.length >= 3) {
        const token3 = highConnectivity[2].symbol;
        console.log(`2. Alternative pair:`);
        console.log(`   node yens-algorithm-poc.js ${token1} ${token3} 10000 --k=5`);
        console.log();
      }
      
      console.log(`3. With verbose output:`);
      console.log(`   node yens-algorithm-poc.js ${token1} ${token2} 10000 --k=5 --verbose`);
      console.log();
      
      console.log(`4. Large order (test price impact):`);
      console.log(`   node yens-algorithm-poc.js ${token1} ${token2} 100000 --k=10`);
      console.log();
      
      console.log(`5. Small order (baseline):`);
      console.log(`   node yens-algorithm-poc.js ${token1} ${token2} 100 --k=5`);
      console.log();
    }
    
    // 5. Show sample pool details
    console.log('📋 Sample Pool Details (Top 5 by Liquidity)');
    console.log('='.repeat(80));
    
    const samplePools = await client.query(`
      SELECT 
        p.addr,
        p.pool_type,
        p.fee_tier,
        CAST(p.liquidity AS NUMERIC) as liquidity,
        t1.ticker as token0,
        t2.ticker as token1,
        CAST(ptm1.reserve AS NUMERIC) as reserve0,
        CAST(ptm2.reserve AS NUMERIC) as reserve1
      FROM pools p
      JOIN pool_token_mps ptm1 ON p.addr = ptm1.pool_id AND ptm1.token_idx = 0
      JOIN pool_token_mps ptm2 ON p.addr = ptm2.pool_id AND ptm2.token_idx = 1
      JOIN tokens t1 ON ptm1.token_addr = t1.addr
      JOIN tokens t2 ON ptm2.token_addr = t2.addr
      WHERE p.status = 'ACTIVE' AND p.liquidity IS NOT NULL
      ORDER BY CAST(p.liquidity AS NUMERIC) DESC
      LIMIT 5
    `);
    
    for (const pool of samplePools.rows) {
      console.log();
      console.log(`Pool: ${pool.token0}-${pool.token1} (${pool.pool_type})`);
      console.log(`  Fee: ${pool.fee_tier}`);
      console.log(`  Liquidity: ${pool.liquidity || 'N/A'}`);
      console.log(`  Reserves: ${pool.reserve0 || 'N/A'} ${pool.token0} / ${pool.reserve1 || 'N/A'} ${pool.token1}`);
      console.log(`  Address: ${pool.addr.substring(0, 20)}...`);
    }
    console.log();
    
    console.log('✅ Analysis complete!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\n💡 Make sure PostgreSQL is running:');
    console.error('   docker-compose ps db');
    console.error('   docker-compose up -d db');
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };

