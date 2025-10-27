#!/usr/bin/env node

const assert = require('assert');
const { optimizeRouteSplittingWaterfill } = require('./phase2-waterfill.js');
const { simulateRoute } = require('./phase1-astar-mike.js');

function makePool({ addr, fee, tokenA, tokenB }) {
  return {
    addr,
    fee,
    tokens: [
      {
        addr: tokenA.addr,
        symbol: tokenA.symbol,
        decimals: tokenA.decimals,
        reserveNum: tokenA.reserveNum,
      },
      {
        addr: tokenB.addr,
        symbol: tokenB.symbol,
        decimals: tokenB.decimals,
        reserveNum: tokenB.reserveNum,
      },
    ],
    getOtherToken(tokenAddr) {
      return this.tokens.find(t => t.addr !== tokenAddr);
    },
    getSpotPrice(tokenInAddr, tokenOutAddr) {
      const tokenIn = this.tokens.find(t => t.addr === tokenInAddr);
      const tokenOut = this.tokens.find(t => t.addr === tokenOutAddr);
      if (!tokenIn || !tokenOut || tokenIn.reserveNum === 0) return 0;
      return (tokenOut.reserveNum / tokenIn.reserveNum) * (1 - this.fee);
    },
  };
}

function buildSingleHopRoute(pool, poolId, fromAddr, toAddr, dxCapRaw) {
  return [
    {
      pool,
      poolId,
      fromAddr,
      toAddr,
      dxCapRaw,
      reserveIn: pool.tokens.find(t => t.addr === fromAddr).reserveNum,
    },
  ];
}

function almostEqual(a, b, tolerance = 1e-6) {
  return Math.abs(a - b) <= tolerance;
}

async function main() {
  const gasPerHopUSD = 0.01;
  const pool = makePool({
    addr: 'pool-1',
    fee: 0.003,
    tokenA: { addr: 'APT-RAW', symbol: 'APT', decimals: 8, reserveNum: 5e9 },
    tokenB: { addr: 'USDC-RAW', symbol: 'USDC', decimals: 6, reserveNum: 2.5e10 },
  });
  
  const route = buildSingleHopRoute(pool, 1, 'APT-RAW', 'USDC-RAW', 1e12);
  const totalInputHuman = 10;
  
  const wrongMetadataSource = { addr: 'APT-RAW', symbol: 'APT', decimals: 6 };
  const correctTargetMetadata = { addr: 'USDC-RAW', symbol: 'USDC', decimals: 6 };
  
  const result = optimizeRouteSplittingWaterfill(
    [route],
    totalInputHuman,
    wrongMetadataSource,
    correctTargetMetadata,
    {
      legacyWaterfill: true,
      verbose: false,
      enableCapacityConstraints: false,
      gasPerHopUSD,
    }
  );
  
  assert(result, 'Expected optimizeRouteSplittingWaterfill to return a result');
  assert.strictEqual(result.routes.length, 1, 'Expected exactly one route in result');
  
  const resolvedInputHuman = result.routes[0].inputHuman;
  assert(
    almostEqual(resolvedInputHuman, totalInputHuman),
    `Input mismatch: expected ${totalInputHuman}, got ${resolvedInputHuman}`
  );
  
  const sourceDecimals = pool.tokens[0].decimals;
  const targetDecimals = pool.tokens[1].decimals;
  const inputRaw = totalInputHuman * Math.pow(10, sourceDecimals);
  const rawOutputWithoutGas = simulateRoute(route, inputRaw);
  const gasRaw = gasPerHopUSD * Math.pow(10, targetDecimals);
  const expectedOutputRaw = Math.max(0, rawOutputWithoutGas - gasRaw);
  const expectedOutputHuman = expectedOutputRaw / Math.pow(10, targetDecimals);
  
  assert(
    almostEqual(result.totalOutputHuman, expectedOutputHuman, 1e-9),
    `Output mismatch: expected ${expectedOutputHuman}, got ${result.totalOutputHuman}`
  );
  
  console.log('✅ Metadata inference test passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
