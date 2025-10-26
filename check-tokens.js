require('dotenv').config();
const { Client } = require('pg');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'tapp',
  user: process.env.DB_USER || 'tapp',
  password: process.env.DB_PASSWORD || 'tapp',
};

async function main() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('✅ Connected to database\n');
    
    // Get tokens with most pools
    const result = await client.query(`
      SELECT 
        t.ticker as symbol,
        t.addr,
        COUNT(DISTINCT ptm.pool_id) as pool_count,
        STRING_AGG(DISTINCT t2.ticker, ', ' ORDER BY t2.ticker) as token_pairs
      FROM tokens t
      JOIN pool_token_mps ptm ON t.addr = ptm.token_addr
      JOIN pools p ON ptm.pool_id = p.addr
      JOIN pool_token_mps ptm2 ON ptm.pool_id = ptm2.pool_id AND ptm2.token_addr != t.addr
      JOIN tokens t2 ON ptm2.token_addr = t2.addr
      WHERE p.status = 'ACTIVE'
      GROUP BY t.ticker, t.addr
      ORDER BY pool_count DESC
      LIMIT 20
    `);
    
    console.log('Top tokens with most pools:');
    console.log('='.repeat(80));
    for (const row of result.rows) {
      console.log(`${row.symbol.padEnd(10)} | ${row.pool_count} pools | pairs with: ${row.token_pairs}`);
    }
    
    // Find sample token pairs that are connected
    const pairsResult = await client.query(`
      SELECT DISTINCT
        t1.ticker as token1,
        t2.ticker as token2,
        COUNT(DISTINCT ptm.pool_id) as direct_pools
      FROM pool_token_mps ptm
      JOIN tokens t1 ON ptm.token_addr = t1.addr
      JOIN pools p ON ptm.pool_id = p.addr
      JOIN pool_token_mps ptm2 ON ptm.pool_id = ptm2.pool_id AND ptm2.token_idx != ptm.token_idx
      JOIN tokens t2 ON ptm2.token_addr = t2.addr
      WHERE p.status = 'ACTIVE'
      GROUP BY t1.ticker, t2.ticker
      ORDER BY direct_pools DESC
      LIMIT 10
    `);
    
    console.log('\nSample token pairs with direct pools:');
    console.log('='.repeat(80));
    for (const row of pairsResult.rows) {
      console.log(`${row.token1} → ${row.token2} (${row.direct_pools} pools)`);
    }
    console.log();
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.end();
  }
}

main();

