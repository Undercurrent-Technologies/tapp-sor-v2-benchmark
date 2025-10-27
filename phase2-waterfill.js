#!/usr/bin/env node
const { performance } = require('perf_hooks');
const { simulateRoute } = require('./phase1-astar-mike.js');
function generateSamplePoints(totalInputRaw) {
  const percentages = [
    0.001, 0.0025, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03,
    0.05, 0.075, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.75, 1.00
  ];
  return percentages.map(pct => totalInputRaw * pct);
}
class MaxHeap {
  constructor() {
    this.heap = [];
  }
  
  push(item) {
    this.heap.push(item);
    this._bubbleUp(this.heap.length - 1);
  }
  
  pop() {
    if (this.heap.length === 0) return null;
    if (this.heap.length === 1) return this.heap.pop();
    
    const max = this.heap[0];
    this.heap[0] = this.heap.pop();
    this._bubbleDown(0);
    return max;
  }
  
  peek() {
    return this.heap.length > 0 ? this.heap[0] : null;
  }
  
  size() {
    return this.heap.length;
  }
  
  _bubbleUp(idx) {
    while (idx > 0) {
      const parentIdx = Math.floor((idx - 1) / 2);
      if (this.heap[idx].marginal <= this.heap[parentIdx].marginal) break;
      [this.heap[idx], this.heap[parentIdx]] = [this.heap[parentIdx], this.heap[idx]];
      idx = parentIdx;
    }
  }
  
  _bubbleDown(idx) {
    while (true) {
      const leftIdx = 2 * idx + 1;
      const rightIdx = 2 * idx + 2;
      let maxIdx = idx;
      
      if (leftIdx < this.heap.length && this.heap[leftIdx].marginal > this.heap[maxIdx].marginal) {
        maxIdx = leftIdx;
      }
      if (rightIdx < this.heap.length && this.heap[rightIdx].marginal > this.heap[maxIdx].marginal) {
        maxIdx = rightIdx;
      }
      if (maxIdx === idx) break;
      
      [this.heap[idx], this.heap[maxIdx]] = [this.heap[maxIdx], this.heap[idx]];
      idx = maxIdx;
    }
  }
}
function validateRoute(route, sourceToken, targetToken, maxHops) {
  if (!route || route.length === 0) return false;
  if (route.length > maxHops) return false;
  
  const poolIds = new Set();
  for (const hop of route) {
    if (poolIds.has(hop.poolId)) return false;
    poolIds.add(hop.poolId);
  }
  
  const epsilon = 1e-6;
  const output = simulateRoute(route, epsilon);
  if (output === 0 || isNaN(output) || !isFinite(output)) return false;
  
  return true;
}
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
    // Prefer symbol if previously missing
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
function buildResponseCurve(route, totalInputHuman, sourceToken, targetToken, gasPerHopInOutputTokensRaw, steps = 18) {
  const totalInputRaw = totalInputHuman * Math.pow(10, sourceToken.decimals);
  const sampleInputs = generateSamplePoints(totalInputRaw);
  
  const curve = [];
  let prevOutputRaw = 0;
  
  let capacityReached = false;
  
  for (const inputRaw of sampleInputs) {
    if (capacityReached) break;
    
    let outputRaw = simulateRoute(route, inputRaw);
    
    const gasCostRaw = route.length * gasPerHopInOutputTokensRaw;
    outputRaw = Math.max(0, outputRaw - gasCostRaw);
    
    if (curve.length > 0 && outputRaw < prevOutputRaw) {
      // Marginal collapsed before this sample. Record a flat point (zero marginal)
      // and stop sampling beyond this capacity.
      outputRaw = prevOutputRaw;
      capacityReached = true;
    }
    
    let marginalRaw = 0;
    if (curve.length > 0) {
      const prevPoint = curve[curve.length - 1];
      const deltaOut = outputRaw - prevPoint.outputRaw;
      const deltaIn = inputRaw - prevPoint.inputRaw;
      marginalRaw = deltaIn > 0 ? deltaOut / deltaIn : 0;
    } else {
      marginalRaw = inputRaw > 0 ? outputRaw / inputRaw : 0;
    }
    
    if (!isFinite(marginalRaw) || isNaN(marginalRaw)) {
      marginalRaw = 0;
    }
    
    curve.push({
      inputRaw,
      outputRaw,
      marginalRaw,
      inputHuman: inputRaw / Math.pow(10, sourceToken.decimals),
      outputHuman: outputRaw / Math.pow(10, targetToken.decimals),
    });
    
    prevOutputRaw = outputRaw;
  }
  
  return curve;
}
function analyzeRouteCapacity(curve, totalInputRaw, relativeCapacityFactor = 0.2) {
  if (!curve || curve.length === 0) return 0;
  
  const initialMarginal = curve[0].marginalRaw;
  if (initialMarginal <= 0) return 0;
  
  // Don't cap based on marginal drop - let the water-filling algorithm handle it
  // The algorithm will naturally stop allocating when marginals get too low
  return curve[curve.length - 1].inputRaw;
}
function buildResponseCurves(
  routes,
  totalInputHuman,
  sourceToken,
  targetToken,
  gasPerHopInOutputTokensRaw,
  steps = 18,
  _minMarginalRatioFilter = 0.0,
  externalCapacities = null,
  verbose = false,
  minInitialEffRatio = 0.0
) {
  if (verbose) console.log(`📈 Building response curves for ${routes.length} routes...`);
  
  const totalInputRaw = totalInputHuman * Math.pow(10, sourceToken.decimals);
  const filteredRoutes = [];
  const curves = [];
  const capacities = [];
  const filteredExternalCapacities = [];
  const initialEffs = [];
  
  for (let idx = 0; idx < routes.length; idx++) {
    const route = routes[idx];
    const curve = buildResponseCurve(route, totalInputHuman, sourceToken, targetToken, gasPerHopInOutputTokensRaw, steps);
    const capacity = analyzeRouteCapacity(curve, totalInputRaw);
    
    let firstEff = 0;
    if (curve.length > 0) {
      const firstPoint = curve[0];
      const inputHuman = firstPoint.inputRaw / Math.pow(10, sourceToken.decimals);
      const outputHuman = firstPoint.outputRaw / Math.pow(10, targetToken.decimals);
      if (inputHuman > 0) {
        const rate = outputHuman / inputHuman;
        firstEff = Number.isFinite(rate) ? rate : 0;
      }
    }
    
    filteredRoutes.push(route);
    curves.push(curve);
    capacities.push(capacity);
    initialEffs.push(firstEff);
    if (externalCapacities && externalCapacities.length > idx) {
      filteredExternalCapacities.push(externalCapacities[idx]);
    }
  }
  
  const bestInitialEff = Math.max(...initialEffs, 0);
  const effThreshold = bestInitialEff * Math.max(0, Math.min(1, minInitialEffRatio));
  
  if (effThreshold > 0 && bestInitialEff > 0) {
    const keepRoutes = [];
    const keepCurves = [];
    const keepCapacities = [];
    const keepInitialEffs = [];
    const keepExternalCaps = [];
    
    for (let i = 0; i < filteredRoutes.length; i++) {
      if (initialEffs[i] >= effThreshold) {
        keepRoutes.push(filteredRoutes[i]);
        keepCurves.push(curves[i]);
        keepCapacities.push(capacities[i]);
        keepInitialEffs.push(initialEffs[i]);
        if (filteredExternalCapacities.length > i) {
          keepExternalCaps.push(filteredExternalCapacities[i]);
        }
      } else if (verbose) {
        console.log(`   ⚠️  Filtering Route ${i + 1}: start eff ${initialEffs[i].toFixed(4)} < threshold ${effThreshold.toFixed(4)}`);
      }
    }
    
    filteredRoutes.length = 0;
    curves.length = 0;
    capacities.length = 0;
    initialEffs.length = 0;
    filteredExternalCapacities.length = 0;
    
    filteredRoutes.push(...keepRoutes);
    curves.push(...keepCurves);
    capacities.push(...keepCapacities);
    initialEffs.push(...keepInitialEffs);
    filteredExternalCapacities.push(...keepExternalCaps);
  }
  
  if (verbose) {
    console.log(`✅ Built ${curves.length} curves (filtered from ${routes.length}, ${curves[0]?.length || 0} points each)`);
    console.log(`📊 Route capacities (curve-based):`);
    capacities.forEach((cap, i) => {
      const capPct = (cap / totalInputRaw * 100).toFixed(2);
      const marginal = curves[i][0]?.marginalRaw || 0;
      const eff = initialEffs[i] || 0;
      console.log(`   Route ${i + 1}: capacity=${capPct}%, marginal=${marginal.toFixed(2)}, eff=${eff.toFixed(4)}`);
    });
    console.log();
  }
  
  return { 
    routes: filteredRoutes, 
    curves, 
    capacities,
    externalCapacities: externalCapacities ? filteredExternalCapacities : null,
    initialEffs
  };
}
function interpolateMarginal(curve, allocatedSoFarRaw) {
  if (allocatedSoFarRaw <= 0) {
    return curve[0]?.marginalRaw || 0;
  }
  
  let i = 0;
  while (i < curve.length && curve[i].inputRaw < allocatedSoFarRaw) {
    i++;
  }
  
  if (i >= curve.length) {
    return curve[curve.length - 1]?.marginalRaw || 0;
  }
  
  if (i === 0) {
    return curve[0].marginalRaw;
  }
  
  const p0 = curve[i - 1];
  const p1 = curve[i];
  
  const deltaInput = p1.inputRaw - p0.inputRaw;
  if (deltaInput === 0) return p0.marginalRaw;
  
  const t = (allocatedSoFarRaw - p0.inputRaw) / deltaInput;
  const marginal = p0.marginalRaw + t * (p1.marginalRaw - p0.marginalRaw);
  
  if (!isFinite(marginal) || isNaN(marginal)) {
    return 0;
  }
  
  return marginal;
}
function findAllocationForMarginal(curve, currentInputRaw, targetMarginal, capacityRaw, tol = 1e-9) {
  const currentMarginal = interpolateMarginal(curve, currentInputRaw);
  if (targetMarginal >= currentMarginal - tol) {
    return { inputRaw: currentInputRaw, reachable: true };
  }
  
  const minMarginal = interpolateMarginal(curve, capacityRaw);
  if (targetMarginal <= minMarginal + tol) {
    return { inputRaw: capacityRaw, reachable: false };
  }
  
  let low = currentInputRaw;
  let high = capacityRaw;
  
  for (let iter = 0; iter < 60; iter++) {
    const mid = (low + high) / 2;
    const midMarginal = interpolateMarginal(curve, mid);
    if (midMarginal > targetMarginal) {
      low = mid;
    } else {
      high = mid;
    }
  }
  
  return { inputRaw: Math.min(high, capacityRaw), reachable: true };
}
function computeTotalsForLevel(
  activeIndices,
  levelMarginal,
  curves,
  allocations,
  capacities,
  tol
) {
  let totalDelta = 0;
  const updates = [];
  const saturated = [];
  let allReachable = true;
  
  for (const idx of activeIndices) {
    const curve = curves[idx];
    const capacity = capacities[idx];
    const currentInput = allocations[idx];
    
    const { inputRaw: targetInputRaw, reachable } = findAllocationForMarginal(
      curve,
      currentInput,
      levelMarginal,
      capacity,
      tol
    );
    
    let nextInput = Math.min(targetInputRaw, capacity);
    let delta = Math.max(0, nextInput - currentInput);
    
    if (!reachable) {
      allReachable = false;
      nextInput = capacity;
      delta = Math.max(0, capacity - currentInput);
      if (capacity - currentInput <= tol) {
        saturated.push(idx);
      }
    }
    
    totalDelta += delta;
    updates.push({
      idx,
      nextInput,
      delta,
      reachable,
    });
  }
  
  return {
    totalDelta,
    updates,
    saturated,
    allReachable,
  };
}
function allocateWaterfillPQ(curves, totalInputRaw, capacities = null, options = {}) {
  const {
    maxIter = 5000,
    tol = 1e-10,
    verbose = false,
  } = options;
  
  const numRoutes = curves.length;
  if (numRoutes === 0) {
    return { allocations: [], totalAllocated: 0, iterations: 0, routesSaturated: 0 };
  }
  
  const effectiveTol = Math.max(tol, totalInputRaw * 1e-12, 1e-9);
  
  const allocations = curves.map(() => 0);
  const effectiveCapacities = capacities && capacities.length === numRoutes
    ? capacities.slice()
    : curves.map(curve => curve[curve.length - 1]?.inputRaw || 0);
  
  const currentMarginals = curves.map(curve => interpolateMarginal(curve, 0));
  const sortedIndices = Array.from({ length: numRoutes }, (_, i) => i)
    .filter(i => effectiveCapacities[i] > effectiveTol && currentMarginals[i] > effectiveTol)
    .sort((a, b) => currentMarginals[b] - currentMarginals[a]);
  
  const active = new Set();
  let pointer = 0;
  let iterations = 0;
  let routesSaturated = 0;
  let remaining = totalInputRaw;
  
  if (verbose) {
    console.log(`🌊 Starting marginal equilibrium allocation...`);
    console.log(`   Total input: ${totalInputRaw.toExponential(4)} raw`);
    console.log(`   Routes discovered: ${sortedIndices.length}`);
    console.log();
  }
  
  const addNextRoute = () => {
    while (pointer < sortedIndices.length) {
      const idx = sortedIndices[pointer++];
      if (effectiveCapacities[idx] <= effectiveTol || currentMarginals[idx] <= effectiveTol) continue;
      active.add(idx);
      if (verbose) {
        console.log(`   Activated route ${idx + 1} (initial marginal ${currentMarginals[idx].toFixed(6)})`);
      }
      return true;
    }
    return false;
  };
  
  while (remaining > effectiveTol && iterations < maxIter) {
    iterations++;
    
    if (active.size === 0) {
      if (!addNextRoute()) break;
      continue;
    }
    
    const activeIndices = Array.from(active);
    const currentLevel = Math.max(...activeIndices.map(idx => currentMarginals[idx]));
    let targetLevel = pointer < sortedIndices.length ? currentMarginals[sortedIndices[pointer]] : 0;
    if (targetLevel > currentLevel) targetLevel = currentLevel;
    
    const totalsAtTarget = computeTotalsForLevel(
      activeIndices,
      targetLevel,
      curves,
      allocations,
      effectiveCapacities,
      effectiveTol
    );
    
    const applyUpdates = (updates, limit) => {
      let used = 0;
      const newlySaturated = [];
      
      for (const update of updates) {
        const idx = update.idx;
        const delta = Math.min(update.delta, Math.max(0, limit - used));
        if (delta <= effectiveTol) continue;
        
        allocations[idx] += delta;
        used += delta;
        currentMarginals[idx] = interpolateMarginal(curves[idx], allocations[idx]);
        
        const remainingCapacity = effectiveCapacities[idx] - allocations[idx];
        if ((!update.reachable && remainingCapacity <= effectiveTol) || remainingCapacity <= effectiveTol) {
          newlySaturated.push(idx);
        }
        
        if (used >= limit - effectiveTol) break;
      }
      
      return { used, newlySaturated };
    };
    
    if (totalsAtTarget.totalDelta <= remaining + effectiveTol && totalsAtTarget.allReachable) {
      const { used, newlySaturated } = applyUpdates(totalsAtTarget.updates, Math.min(remaining, totalsAtTarget.totalDelta));
      remaining -= used;
      if (used <= effectiveTol) {
        const totalAllocatedNow = allocations.reduce((sum, amt) => sum + amt, 0);
        remaining = Math.max(0, totalInputRaw - totalAllocatedNow);
      }
      
      for (const idx of newlySaturated) {
        if (active.delete(idx)) {
          routesSaturated++;
          if (verbose) {
            console.log(`      Route ${idx + 1} saturated at ${(allocations[idx] / totalInputRaw * 100).toFixed(4)}%`);
          }
        }
      }
      
      if (totalsAtTarget.allReachable && pointer < sortedIndices.length && remaining > effectiveTol) {
        addNextRoute();
      }
    } else {
      let low = targetLevel;
      let high = currentLevel;
      let bestUpdates = totalsAtTarget;
      
      for (let iter = 0; iter < 60; iter++) {
        const mid = (low + high) / 2;
        const totals = computeTotalsForLevel(
          activeIndices,
          mid,
          curves,
          allocations,
          effectiveCapacities,
          effectiveTol
        );
        
        if (totals.totalDelta > remaining + effectiveTol) {
          low = mid;
        } else {
          high = mid;
          bestUpdates = totals;
        }
      }
      
      const { used, newlySaturated } = applyUpdates(bestUpdates.updates, Math.min(remaining, bestUpdates.totalDelta));
      remaining -= used;
      if (used <= effectiveTol) {
        const totalAllocatedNow = allocations.reduce((sum, amt) => sum + amt, 0);
        remaining = Math.max(0, totalInputRaw - totalAllocatedNow);
      }
      
      for (const idx of newlySaturated) {
        if (active.delete(idx)) {
          routesSaturated++;
          if (verbose) {
            console.log(`      Route ${idx + 1} saturated at ${(allocations[idx] / totalInputRaw * 100).toFixed(4)}%`);
          }
        }
      }
    }
    
    if (remaining <= effectiveTol) break;
    
    for (const idx of Array.from(active)) {
      const remainingCapacity = effectiveCapacities[idx] - allocations[idx];
      if (remainingCapacity <= effectiveTol || currentMarginals[idx] <= effectiveTol) {
        active.delete(idx);
        routesSaturated++;
        if (verbose) {
          console.log(`      Route ${idx + 1} saturated at ${(allocations[idx] / totalInputRaw * 100).toFixed(4)}%`);
        }
      }
    }
  }
  
  const totalAllocated = totalInputRaw - remaining;
  
  if (verbose) {
    console.log(`   Total iterations: ${iterations}`);
    console.log(`   Routes saturated: ${routesSaturated}/${curves.length}`);
    console.log(`   Allocated: ${(totalAllocated / totalInputRaw * 100).toFixed(4)}%\n`);
  }
  
  return { allocations, totalAllocated, iterations, routesSaturated };
}
function allocateWaterfill(curves, totalInputRaw, capacities = null, options = {}) {
  const {
    chunkCoarse = 0.05,
    chunkFine = 0.001,
    maxIter = 200,
    tol = 1e-10,
    minPct = 0.001,
    verbose = false,
  } = options;
  
  if (verbose) {
    console.log(`🌊 Starting water-filling allocation...`);
    console.log(`   Total input: ${totalInputRaw.toExponential(4)} raw`);
    console.log(`   Routes: ${curves.length}`);
    console.log(`   Capacity constraints: ${capacities ? 'ENABLED' : 'DISABLED'}`);
  }
  
  const allocations = curves.map(() => 0);
  let totalAllocated = 0;
  let iterations = 0;
  
  const phases = [
    { name: 'COARSE', chunk: totalInputRaw * chunkCoarse, maxPhaseIter: 100 },
    { name: 'FINE', chunk: totalInputRaw * chunkFine, maxPhaseIter: 100 },
  ];
  
  for (const phase of phases) {
    if (verbose) console.log(`   Phase: ${phase.name}, chunk size: ${(phase.chunk / totalInputRaw * 100).toFixed(2)}%`);
    
    let phaseIterations = 0;
    
    while (totalAllocated < totalInputRaw && phaseIterations < phase.maxPhaseIter && iterations < maxIter) {
      iterations++;
      phaseIterations++;
      
      let bestRouteIdx = -1;
      let bestMarginal = -Infinity;
      
      for (let i = 0; i < curves.length; i++) {
        const marginal = interpolateMarginal(curves[i], allocations[i]);
        
        if (marginal <= 0) continue;
        if (allocations[i] + phase.chunk > totalInputRaw) continue;
        
        if (capacities && allocations[i] >= capacities[i]) {
          if (verbose && iterations <= 5) {
            console.log(`   Route ${i + 1} hit capacity at ${allocations[i].toExponential(4)} (cap: ${capacities[i].toExponential(4)})`);
          }
          continue;
        }
        
        if (marginal > bestMarginal) {
          bestMarginal = marginal;
          bestRouteIdx = i;
        }
      }
      
      if (bestRouteIdx === -1) {
        // Check if all routes are capacity-capped vs naturally exhausted
        const allCapped = capacities && curves.every((_, i) => allocations[i] >= capacities[i]);
        const allocationPct = (totalAllocated / totalInputRaw * 100).toFixed(2);
        
        if (allCapped && totalAllocated < totalInputRaw * 0.5) {
          if (verbose) console.log(`   ❌ ERROR: All routes capacity-capped at ${allocationPct}% - capacities too restrictive!`);
        } else {
          if (verbose) console.log(`   ✅ All routes naturally exhausted at iteration ${iterations} (${allocationPct}% allocated)`);
        }
        break;
      }
      
      let amountToAllocate = Math.min(phase.chunk, totalInputRaw - totalAllocated);
      
      if (capacities) {
        const remainingCapacity = capacities[bestRouteIdx] - allocations[bestRouteIdx];
        amountToAllocate = Math.min(amountToAllocate, remainingCapacity);
      }
      
      allocations[bestRouteIdx] += amountToAllocate;
      totalAllocated += amountToAllocate;
      
      if (verbose && iterations % 10 === 0) {
        const top3Marginals = curves
          .map((c, i) => ({ idx: i, marginal: interpolateMarginal(c, allocations[i]) }))
          .sort((a, b) => b.marginal - a.marginal)
          .slice(0, 3);
        
        console.log(`   Iter ${iterations}: allocated ${(totalAllocated / totalInputRaw * 100).toFixed(2)}%`);
        console.log(`      Top-3 marginals: ${top3Marginals.map(m => m.marginal.toFixed(6)).join(', ')}`);
      }
      
      const marginals = curves.map((c, i) => interpolateMarginal(c, allocations[i]));
      const sortedMarginals = marginals.filter(m => m > 0).sort((a, b) => b - a);
      
      if (sortedMarginals.length >= 2) {
        const maxMarginal = sortedMarginals[0];
        const secondMaxMarginal = sortedMarginals[1];
        
        if (maxMarginal - secondMaxMarginal <= tol) {
          if (verbose) console.log(`   ✅ Converged at iteration ${iterations} (marginals within tolerance)`);
          break;
        }
      }
      
      if (Math.abs(totalAllocated - totalInputRaw) < 1e-6) {
        if (verbose) console.log(`   ✅ Fully allocated at iteration ${iterations}`);
        break;
      }
    }
  }
  
  if (verbose) {
    console.log(`   Total iterations: ${iterations}`);
    console.log(`   Allocated: ${totalAllocated.toExponential(4)} raw (${(totalAllocated / totalInputRaw * 100).toFixed(4)}%)\n`);
  }
  
  return { allocations, totalAllocated, iterations };
}
function normalizeAllocations(allocations, totalInputRaw, minPct = 0.001, verbose = false) {
  if (verbose) console.log(`🔧 Normalizing allocations...`);
  
  const minAllocation = totalInputRaw * minPct;
  const sumBefore = allocations.reduce((sum, amt) => sum + amt, 0);
  const sumDiff = Math.abs(sumBefore - totalInputRaw);
  const toleranceRaw = Math.max(1, totalInputRaw * 1e-9);
  if (sumDiff <= toleranceRaw) {
    const satisfiesMin = allocations.every(amt => amt === 0 || amt >= minAllocation);
    if (satisfiesMin) {
      if (verbose) console.log(`   Skipping normalization (already balanced within tolerance)`);
      return allocations.slice();
    }
  }
  
  let dustTotal = 0;
  const cleanAllocations = allocations.map((amt) => {
    if (amt < minAllocation && amt > 0) {
      dustTotal += amt;
      return 0;
    }
    return amt;
  });
  
  if (dustTotal > 0) {
    const bestIdx = cleanAllocations.indexOf(Math.max(...cleanAllocations));
    cleanAllocations[bestIdx] += dustTotal;
    if (verbose) console.log(`   Redistributed ${dustTotal.toExponential(2)} raw dust to route ${bestIdx}`);
  }
  
  const currentTotal = cleanAllocations.reduce((sum, amt) => sum + amt, 0);
  if (currentTotal === 0) return cleanAllocations;
  
  const scale = totalInputRaw / currentTotal;
  const normalized = cleanAllocations.map(amt => amt * scale);
  
  const finalTotal = normalized.reduce((sum, amt) => sum + amt, 0);
  if (verbose) console.log(`   Final total: ${finalTotal.toExponential(4)} raw (error: ${Math.abs(finalTotal - totalInputRaw).toExponential(2)})\n`);
  
  return normalized;
}
function simulateAllocation(
  routes,
  allocationsRaw,
  sourceToken,
  targetToken,
  gasPerHopInOutputTokensRaw,
  gasPolicy = 'per-route',
  verbose = false,
  initialEffRates = null,
  curves = null
) {
  if (verbose) console.log(`🎯 Running final simulation...`);
  
  const results = [];
  let totalOutputRaw = 0;
  
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const inputRaw = allocationsRaw[i];
    
    if (inputRaw === 0) continue;
    
    let outputRaw = simulateRoute(route, inputRaw);
    
    const gasCostRaw = route.length * gasPerHopInOutputTokensRaw;
    
    if (gasPolicy === 'per-route') {
      outputRaw = Math.max(0, outputRaw - gasCostRaw);
    }
    
    totalOutputRaw += outputRaw;
    
    const inputHuman = inputRaw / Math.pow(10, sourceToken.decimals);
    const outputHuman = outputRaw / Math.pow(10, targetToken.decimals);
    let finalMarginalHuman = 0;
    if (curves && Array.isArray(curves) && curves.length > i) {
      const marginalRaw = interpolateMarginal(curves[i], inputRaw);
      const scale = Math.pow(10, sourceToken.decimals - targetToken.decimals);
      finalMarginalHuman = marginalRaw * scale;
    } else {
      finalMarginalHuman = outputHuman / inputHuman;
    }
    
    const startEffRate = Array.isArray(initialEffRates) && initialEffRates.length > i
      ? initialEffRates[i]
      : null;
    
    results.push({
      routeIdx: i,
      route,
      inputRaw,
      outputRaw,
      inputHuman,
      outputHuman,
      hops: route.length,
      effRate: finalMarginalHuman,
      initialEffRate: startEffRate,
      gasCostRaw: gasPolicy === 'per-route' ? gasCostRaw : 0,
    });
  }
  
  if (gasPolicy === 'global') {
    const totalGasCost = results.reduce((sum, r) => sum + r.route.length * gasPerHopInOutputTokensRaw, 0);
    totalOutputRaw = Math.max(0, totalOutputRaw - totalGasCost);
  }
  
  const totalInputRaw = allocationsRaw.reduce((sum, amt) => sum + amt, 0);
  const totalInputHuman = totalInputRaw / Math.pow(10, sourceToken.decimals);
  const totalOutputHuman = totalOutputRaw / Math.pow(10, targetToken.decimals);
  
  if (verbose) {
    console.log(`   Routes used: ${results.length}`);
    console.log(`   Total output: ${totalOutputHuman.toFixed(4)} ${targetToken.symbol}\n`);
  }
  
  return {
    totalInputRaw,
    totalOutputRaw,
    totalInputHuman,
    totalOutputHuman,
    routes: results,
    gasPolicy,
  };
}
function optimizeRouteSplittingWaterfill(routes, totalInputHuman, sourceToken, targetToken, options = {}) {
  const {
    steps = 18,
    chunkCoarse = 0.05,
    chunkFine = 0.001,
    maxIterations = 5000,
    tol = 1e-10,
    minPct = 0.001,
    maxHops = 3,
    gasPerHopUSD = 0.01,
    verbose = false,
    enableCapacityConstraints = true,
    capacityMarginalDropThreshold = 0.5,
    capacityMinMarginalRatio = 0.1,
    minMarginalRatioFilter = 0.01,
    routeCapacities = null,
    legacyWaterfill = false,
    minInitialEffRatio = 0.0,
  } = options;
  const tStart = performance.now();
  let tAfterPrep;
  let tAfterCurves;
  let tAfterAllocation;
  let tAfterNormalization;
  let tAfterSimulation;
  
  console.log('='.repeat(80));
  console.log('🌊 PHASE 2: WATER-FILLING ROUTE SPLITTING');
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
  
  const { routes: dedupedRoutes, capacities: dedupedCapacities } = deduplicateRoutes(validRoutes, routeCapacities, verbose);
  
  let resolvedTokens;
  try {
    resolvedTokens = resolveEndpointMetadata(dedupedRoutes, sourceToken, targetToken);
  } catch (metaError) {
    console.log(`❌ Error resolving token metadata: ${metaError.message}`);
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
  
  tAfterPrep = performance.now();
  
  const {
    routes: filteredRoutes,
    curves,
    capacities,
    externalCapacities,
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
  tAfterCurves = performance.now();
  
  const totalInputRaw = totalInputHuman * Math.pow(10, resolvedSourceToken.decimals);
  
  let finalCapacities;
  if (externalCapacities && externalCapacities.length === filteredRoutes.length) {
    // Use the minimum of external and curve-based capacities
    finalCapacities = externalCapacities.map((extCap, i) => Math.min(extCap, capacities[i]));
    if (verbose) {
      console.log(`📊 Using combined route capacities (min of external and curve-based):`);
      finalCapacities.forEach((cap, i) => {
        const capPct = (cap / totalInputRaw * 100).toFixed(2);
        const extPct = (externalCapacities[i] / totalInputRaw * 100).toFixed(2);
        const curvePct = (capacities[i] / totalInputRaw * 100).toFixed(2);
        console.log(`   Route ${i + 1}: capacity=${capPct}% (external=${extPct}%, curve=${curvePct}%)`);
      });
      console.log();
    }
  } else {
    finalCapacities = capacities;
    if (verbose && externalCapacities) {
      console.log(`⚠️  External capacities length mismatch (${externalCapacities.length} vs ${filteredRoutes.length}), using curve-based capacities\n`);
    }
  }
  
  let allocations, totalAllocated, iterations, routesSaturated;
  let algorithmLabel;
  
  if (legacyWaterfill) {
    if (verbose) console.log(`🔧 Using LEGACY water-filling algorithm\n`);
    const result = allocateWaterfill(
      curves, 
      totalInputRaw, 
      enableCapacityConstraints ? finalCapacities : null,
      {
        chunkCoarse,
        chunkFine,
        maxIter: maxIterations,
        tol,
        minPct,
        verbose,
      }
    );
    allocations = result.allocations;
    totalAllocated = result.totalAllocated;
    iterations = result.iterations;
    routesSaturated = undefined;
    algorithmLabel = 'Legacy';
  } else {
    if (verbose) console.log(`🚀 Using PRIORITY QUEUE water-filling algorithm\n`);
    const result = allocateWaterfillPQ(
      curves,
      totalInputRaw,
      enableCapacityConstraints ? finalCapacities : null,
      {
        chunkCoarse,
        chunkFine,
        maxIter: maxIterations,
        tol,
        verbose,
      }
    );
    allocations = result.allocations;
    totalAllocated = result.totalAllocated;
    iterations = result.iterations;
    routesSaturated = result.routesSaturated;
    algorithmLabel = 'Priority Queue';
  }
  tAfterAllocation = performance.now();
  
  // Warn if we're about to normalize a very low allocation (likely a bug)
  const allocationPct = totalAllocated / totalInputRaw;
  if (allocationPct < 0.5 && verbose) {
    console.log(`⚠️  WARNING: Only allocated ${(allocationPct * 100).toFixed(2)}% before normalization`);
    console.log(`   This suggests capacity constraints are too restrictive or iteration limit too low`);
  }
  
  console.log(`📊 Allocation Summary:`);
  console.log(`   Algorithm: ${algorithmLabel || 'Unknown'}`);
  if (routesSaturated !== undefined) {
    console.log(`   Routes saturated: ${routesSaturated}/${filteredRoutes.length}`);
  }
  console.log(`   Total allocated: ${(allocationPct * 100).toFixed(2)}%`);
  console.log(`   Iterations: ${iterations}\n`);
  
  const normalizedAllocations = normalizeAllocations(allocations, totalInputRaw, minPct, verbose);
  tAfterNormalization = performance.now();
  
  const result = simulateAllocation(
    filteredRoutes,
    normalizedAllocations,
    resolvedSourceToken,
    resolvedTargetToken,
    gasPerHopInOutputTokensRaw,
    'per-route',
    verbose,
    initialEffs,
    curves
  );
  tAfterSimulation = performance.now();
  
  result.iterations = iterations;
  
  const timingSummary = {
    prep: tAfterPrep - tStart,
    curveBuild: tAfterCurves - tAfterPrep,
    allocation: tAfterAllocation - tAfterCurves,
    normalization: tAfterNormalization - tAfterAllocation,
    simulation: tAfterSimulation - tAfterNormalization,
    total: tAfterSimulation - tStart,
  };
  
  if (!verbose) {
    console.log(`⏱️  Phase 2 Timing:`);
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
  generateSamplePoints,
  validateRoute,
  buildResponseCurve,
  buildResponseCurves,
  interpolateMarginal,
  allocateWaterfill,
  allocateWaterfillPQ,
  normalizeAllocations,
  simulateAllocation,
  optimizeRouteSplittingWaterfill,
};
