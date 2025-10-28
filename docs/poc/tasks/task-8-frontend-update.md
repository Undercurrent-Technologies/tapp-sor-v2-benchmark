# Task 8: Frontend Update for Splits

> **Story Points:** 5 (Medium)  
> **Priority:** 🔴 CRITICAL  
> **Depends:** Task 6, Task 7  
> **Phase:** 2.2

---

## 🎯 Goal

Handle new response format with splits field

---

## 📋 Subtasks

### **8.1. Update TypeScript Types**

#### Implementation Guide:

```typescript
File: tapp/frontend/src/components/swap/sor.ts

// Purpose: Add splits field to Entry interface
// 
// Changes:
//   - routeIdx: number → routeIdx?: number (optional now)
//   - Add: splits?: Split[]
//
// New interface: Split
//   - routeIdx: number
//   - amount: string
//
// Backward compatibility:
//   Phase 2.1: Entry has routeIdx only
//   Phase 2.2: Entry has splits array

Example:
  // Single route (Phase 2.1):
  { routeIdx: 1, splits: undefined }
  
  // Multiple routes (Phase 2.2):
  { routeIdx: 1, splits: [{routeIdx:0, amount:"20"}, {routeIdx:1, amount:"80"}] }
```

**Deliverable:** TypeScript types updated

---

### **8.2. Update Handler Logic**

#### Implementation Guide:

```typescript
File: tapp/frontend/src/components/swap/utils/est-swap-handler.ts

// Purpose: Support both single route and splits
//
// Logic:
//   IF entry.splits exists:
//     → Use multiple routes (Phase 2.2)
//     → Map splits to route array
//   ELSE:
//     → Use single route (Phase 2.1)
//     → Use entry.routeIdx
//
// Ensures backward compatibility with Phase 2.1
```

**Deliverable:** Handler supports splits

---

### **8.3. Update Serialization**

#### Implementation Guide:

```typescript
File: tapp/frontend/src/components/swap/utils/helper.ts

// Purpose: Serialize swap transaction for multiple routes
// 
// Logic:
//   IF splits exists:
//     → Serialize multiple routes to BCS (Phase 2.2)
//     → Smart contract executes multi-route swap
//   ELSE:
//     → Serialize single route (Phase 2.1)
//
// Output: Uint8Array for transaction payload

Note: May require smart contract support for multi-route swaps
```

**Deliverable:** Serialization for splits

---

### **8.4. Update UI (Optional)**

#### Implementation Guide:

```typescript
// Purpose: Show route split information to user
// 
// Example display:
//   "Swapping via 3 routes:"
//   "  • 20% via APT→USDC"
//   "  • 30% via APT→WETH→USDC"
//   "  • 50% via APT→BTC→USDC"
//
// Benefits: Better transparency, user understands routing

Optional: Low priority, can skip for MVP
```

**Deliverable:** Better UX (optional)

---

### **8.5. Testing**

#### Test Cases:

```bash
Test Phase 2.1 (single route):
  ✅ routeIdx field used correctly
  ✅ No splits field (or undefined)

Test Phase 2.2 (splits):
  ✅ Splits array populated
  ✅ Splits sum to 100% of amount
  ✅ Serialization produces valid transaction

Test backward compatibility:
  ✅ Can switch between est-swap2 and est-swap3
  ✅ Can switch between Phase 2.1 and 2.2
```

**Deliverable:** Frontend validated

---

## ✅ Definition of Done

- [ ] TypeScript types updated
- [ ] EstSwap2Handler supports splits
- [ ] serializeSOR handles multiple routes
- [ ] UI updated (optional)
- [ ] Backward compatibility tested
- [ ] Tests pass
- [ ] Code reviewed

---

**Back to:** [Implementation Overview](../IMPLEMENTATION-TASKS-BREAKDOWN.md)

