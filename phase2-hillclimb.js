#!/usr/bin/env node
const { performance } = require('perf_hooks');
const {
  validateRoute,
  buildResponseCurves,
  normalizeAllocations,
  simulateAllocation,
} = require('./phase2-waterfill.js');
const { simulateRoute } = require('./phase1-astar-mike.js');

function getRouteSignature(route) {
  return route.map(hop => hop.poolId).join('-');
}

function deduplicateRoutes(routes, routeCapacities = null, verbose = false) {
  const seen = new Map();
  const dedupedRoutes = [];
  const dedupedCapacities = [];

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const sig = getRouteSignature(route);
    if (!seen.has(sig)) {
      seen.set(sig, true);
      dedupedRoutes.push(route);
      if (routeCapacities) {
        dedupedCapacities.push(routeCapacities[i]);
      }
    } else if (verbose) {
      console.log(`   ⚠️  Skipping duplicate route: ${sig.substring(0, 50)}...`);
    }
  }

  if (verbose && dedupedRoutes.length < routes.length) {
    console.log(`✅ Deduplicated ${routes.length} → ${dedupedRoutes.length} routes\n`);
  }

  return { routes: dedupedRoutes, capacities: routeCapacities ? dedupedCapacities : null };
}

function findTokenMetadataInHop(hop, tokenAddr) {
  if (!hop || !hop.pool || !hop.pool.tokens) return null;
  return hop.pool.tokens.find(token => token.addr === tokenAddr) || null;
}

function normalizeTokenMetadata(token) {
  if (!token) return null;
  const decimals = typeof token.decimals === 'number'
    ? token.decimals
    : parseInt(token.decimals, 10);
  if (!Number.isFinite(decimals)) return null;
  return {
    addr: token.addr,
    symbol: token.symbol,
    decimals,
  };
}

function inferEndpointToken(routes, endpoint) {
  let inferred = null;
  for (const route of routes) {
    if (!route || route.length === 0) continue;
    const hop = endpoint === 'source' ? route[0] : route[route.length - 1];
    const tokenAddr = endpoint === 'source' ? hop?.fromAddr : hop?.toAddr;
    const token = findTokenMetadataInHop(hop, tokenAddr);
    if (!token) continue;
    const normalized = normalizeTokenMetadata(token);
    if (!normalized) continue;
    if (!inferred) {
      inferred = normalized;
      continue;
    }
    if (inferred.addr !== normalized.addr) {
      throw new Error(`Inconsistent ${endpoint} tokens detected across routes (${inferred.addr} vs ${normalized.addr})`);
    }
    if (inferred.decimals !== normalized.decimals) {
      throw new Error(`Inconsistent ${endpoint} token decimals detected across routes for addr=${normalized.addr}`);
    }
    if (!inferred.symbol && normalized.symbol) {
      inferred.symbol = normalized.symbol;
    }
  }
  return inferred;
}

function resolveEndpointMetadata(routes, sourceHint, targetHint) {
  const sourceFromRoutes = inferEndpointToken(routes, 'source');
  const targetFromRoutes = inferEndpointToken(routes, 'target');

  const resolvedSource = sourceFromRoutes || (sourceHint ? normalizeTokenMetadata(sourceHint) : null);
  const resolvedTarget = targetFromRoutes || (targetHint ? normalizeTokenMetadata(targetHint) : null);

  if (!resolvedSource || !resolvedTarget) {
    throw new Error('Unable to determine token metadata for route endpoints (missing decimals or token addr)');
  }

  const warnings = [];

  if (sourceFromRoutes && sourceHint) {
    if (sourceHint.addr && sourceHint.addr !== sourceFromRoutes.addr) {
      warnings.push(`⚠️  Source token addr mismatch: hint=${sourceHint.addr} routes=${sourceFromRoutes.addr}. Using route metadata.`);
    }
    if (typeof sourceHint.decimals === 'number' && sourceHint.decimals !== sourceFromRoutes.decimals) {
      warnings.push(`⚠️  Source token decimals mismatch: hint=${sourceHint.decimals} routes=${sourceFromRoutes.decimals}. Using route metadata.`);
    }
  }

  if (targetFromRoutes && targetHint) {
    if (targetHint.addr && targetHint.addr !== targetFromRoutes.addr) {
      warnings.push(`⚠️  Target token addr mismatch: hint=${targetHint.addr} routes=${targetFromRoutes.addr}. Using route metadata.`);
    }
    if (typeof targetHint.decimals === 'number' && targetHint.decimals !== targetFromRoutes.decimals) {
      warnings.push(`⚠️  Target token decimals mismatch: hint=${targetHint.decimals} routes=${targetFromRoutes.decimals}. Using route metadata.`);
    }
  }

  return {
    sourceToken: resolvedSource,
    targetToken: resolvedTarget,
    warnings,
    sourceResolvedFromRoutes: Boolean(sourceFromRoutes),
    targetResolvedFromRoutes: Boolean(targetFromRoutes),
  };
}

function computeTotalOutputRaw(routes, allocationsRaw, gasPerHopRaw) {
  let total = 0;
  for (let i = 0; i < routes.length; i++) {
    const amount = allocationsRaw[i];
    if (!amount || amount <= 0) continue;
    let output = simulateRoute(routes[i], amount);
    output = Math.max(0, output - routes[i].length * gasPerHopRaw);
    total += output;
  }
  return total;
}

function optimizeRouteSplittingHillClimb(
  routes,
  totalInputHuman,
  sourceToken,
  targetToken,
  options = {}
) {
  const {
    maxHops = 3,
    gasPerHopUSD = 0.01,
    routeCapacities = null,
    verbose = false,
    maxIterations = 200,
    deltaPct = 0.001,
    maxActiveRoutes = 10,
    steps = 18,
    minMarginalRatioFilter = 0.0,
    minInitialEffRatio = 0.0,
  } = options;

  const tStart = performance.now();

  console.log('='.repeat(80));
  console.log('🧗 PHASE 2: HILL-CLIMBING ROUTE SPLITTING');
  console.log('='.repeat(80));
  console.log();

  console.log(`📋 Validating ${routes.length} routes...`);
  const validRoutes = routes.filter(route =>
    validateRoute(route, sourceToken, targetToken, maxHops)
  );
  console.log(`✅ ${validRoutes.length} valid routes\n`);

  if (validRoutes.length === 0) {
    console.log('❌ No valid routes found!\n');
    return null;
  }

  const { routes: dedupedRoutes, capacities: dedupedCapacities } = deduplicateRoutes(
    validRoutes,
    routeCapacities,
    verbose
  );

  let resolvedTokens;
  try {
    resolvedTokens = resolveEndpointMetadata(dedupedRoutes, sourceToken, targetToken);
  } catch (err) {
    console.log(`❌ Error resolving token metadata: ${err.message}`);
    return null;
  }

  if (resolvedTokens.warnings.length > 0) {
    resolvedTokens.warnings.forEach(msg => console.log(msg));
    console.log();
  }

  if (resolvedTokens.sourceResolvedFromRoutes || resolvedTokens.targetResolvedFromRoutes) {
    console.log(`🔍 Using route-derived metadata:`);
    if (resolvedTokens.sourceResolvedFromRoutes) {
      console.log(`  Source: ${resolvedTokens.sourceToken.symbol || 'UNKNOWN'} (${resolvedTokens.sourceToken.addr}), decimals=${resolvedTokens.sourceToken.decimals}`);
    }
    if (resolvedTokens.targetResolvedFromRoutes) {
      console.log(`  Target: ${resolvedTokens.targetToken.symbol || 'UNKNOWN'} (${resolvedTokens.targetToken.addr}), decimals=${resolvedTokens.targetToken.decimals}`);
    }
    console.log();
  }

  const resolvedSourceToken = resolvedTokens.sourceToken;
  const resolvedTargetToken = resolvedTokens.targetToken;

  const targetTokenUSDPrice = 1.0;
  const gasPerHopInOutputTokens = gasPerHopUSD / targetTokenUSDPrice;
  const gasPerHopInOutputTokensRaw = gasPerHopInOutputTokens * Math.pow(10, resolvedTargetToken.decimals);

  console.log(`Gas Configuration:`);
  console.log(`  Gas per hop: $${gasPerHopUSD} = ${gasPerHopInOutputTokens.toFixed(4)} ${resolvedTargetToken.symbol || targetToken.symbol || 'OUTPUT'}`);
  console.log(`  Gas per hop (raw): ${gasPerHopInOutputTokensRaw.toExponential(4)}`);
  console.log();

  const tAfterPrep = performance.now();

  const {
    curves,
    initialEffs,
  } = buildResponseCurves(
    dedupedRoutes,
    totalInputHuman,
    resolvedSourceToken,
    resolvedTargetToken,
    gasPerHopInOutputTokensRaw,
    steps,
    minMarginalRatioFilter,
    dedupedCapacities,
    verbose,
    minInitialEffRatio
  );

  const tAfterCurves = performance.now();

  const totalInputRaw = totalInputHuman * Math.pow(10, resolvedSourceToken.decimals);
  const deltaRaw = Math.max(1, Math.round(totalInputRaw * deltaPct));
  const allocationsRaw = dedupedRoutes.map(() => 0);
  allocationsRaw[0] = totalInputRaw;

  let allocationEntries = [{ routeIdx: 0, amountRaw: totalInputRaw }];
  let iterations = 0;
  let improved = true;

  const recomputeEntries = () => {
    allocationEntries = [];
    for (let i = 0; i < allocationsRaw.length; i++) {
      const amt = allocationsRaw[i];
      if (amt > 0) {
        allocationEntries.push({ routeIdx: i, amountRaw: amt });
      }
    }
    allocationEntries.sort((a, b) => b.amountRaw - a.amountRaw);
  };

  const getCurrentOutput = () => computeTotalOutputRaw(dedupedRoutes, allocationsRaw, gasPerHopInOutputTokensRaw);

  let currentOutput = getCurrentOutput();

  while (improved && iterations < maxIterations && allocationEntries.length <= maxActiveRoutes) {
    iterations++;
    improved = false;

    let bestGain = 0;
    let bestMove = null;

    for (const from of allocationEntries) {
      if (from.amountRaw < deltaRaw) continue;
      for (let toRouteIdx = 0; toRouteIdx < dedupedRoutes.length; toRouteIdx++) {
        if (toRouteIdx === from.routeIdx) continue;

        allocationsRaw[from.routeIdx] -= deltaRaw;
        allocationsRaw[toRouteIdx] += deltaRaw;

        const newOutput = computeTotalOutputRaw(dedupedRoutes, allocationsRaw, gasPerHopInOutputTokensRaw);
        const gain = newOutput - currentOutput;

        if (gain > bestGain) {
          bestGain = gain;
          bestMove = { fromRouteIdx: from.routeIdx, toRouteIdx, delta: deltaRaw };
        }

        allocationsRaw[toRouteIdx] -= deltaRaw;
        allocationsRaw[from.routeIdx] += deltaRaw;
      }
    }

    if (bestGain > 0 && bestMove) {
      allocationsRaw[bestMove.fromRouteIdx] -= bestMove.delta;
      allocationsRaw[bestMove.toRouteIdx] += bestMove.delta;
      currentOutput += bestGain;
      improved = true;

      if (verbose) {
        console.log(`   Iter ${iterations}: moved ${(bestMove.delta / totalInputRaw * 100).toFixed(4)}% from route ${bestMove.fromRouteIdx + 1} → ${bestMove.toRouteIdx + 1}, gain=${(bestGain / Math.pow(10, resolvedTargetToken.decimals)).toFixed(6)} ${resolvedTargetToken.symbol}`);
      }

      recomputeEntries();

      if (allocationEntries.length > maxActiveRoutes) {
        const smallest = allocationEntries[allocationEntries.length - 1];
        const largest = allocationEntries[0];
        if (smallest && largest && smallest.routeIdx !== largest.routeIdx) {
          allocationsRaw[largest.routeIdx] += allocationsRaw[smallest.routeIdx];
          allocationsRaw[smallest.routeIdx] = 0;
          recomputeEntries();
          currentOutput = computeTotalOutputRaw(dedupedRoutes, allocationsRaw, gasPerHopInOutputTokensRaw);
        }
      }
    }
  }

  const tAfterAllocation = performance.now();

  const normalizedAllocations = normalizeAllocations(allocationsRaw, totalInputRaw, 0.001, verbose);
  const tAfterNormalization = performance.now();

  const result = simulateAllocation(
    dedupedRoutes,
    normalizedAllocations,
    resolvedSourceToken,
    resolvedTargetToken,
    gasPerHopInOutputTokensRaw,
    'per-route',
    verbose,
    initialEffs,
    curves
  );

  result.iterations = iterations;
  result.algorithm = 'Hill Climb';

  const tAfterSimulation = performance.now();

  const timingSummary = {
    prep: tAfterPrep - tStart,
    curveBuild: tAfterCurves - tAfterPrep,
    allocation: tAfterAllocation - tAfterCurves,
    normalization: tAfterNormalization - tAfterAllocation,
    simulation: tAfterSimulation - tAfterNormalization,
    total: tAfterSimulation - tStart,
  };

  if (!verbose) {
    console.log(`⏱️  Phase 2 Timing (Hill Climb):`);
    console.log(`  Prep & metadata: ${timingSummary.prep.toFixed(3)}ms`);
    console.log(`  Response curves: ${timingSummary.curveBuild.toFixed(3)}ms`);
    console.log(`  Allocation: ${timingSummary.allocation.toFixed(3)}ms`);
    console.log(`  Normalization: ${timingSummary.normalization.toFixed(3)}ms`);
    console.log(`  Simulation: ${timingSummary.simulation.toFixed(3)}ms`);
    console.log(`  Total: ${timingSummary.total.toFixed(3)}ms\n`);
  }

  result.timings = timingSummary;

  return result;
}

module.exports = {
  optimizeRouteSplittingHillClimb,
};
