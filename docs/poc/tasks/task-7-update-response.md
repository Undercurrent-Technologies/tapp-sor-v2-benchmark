# Task 7: Update est-swap3 Response

> **Story Points:** 5 (Medium)  
> **Priority:** 🔴 CRITICAL  
> **Depends:** Task 6 (route splitting)  
> **Phase:** 2.2

---

## 🎯 Goal

Add `splits` field to est-swap3 response format

---

## 📋 Subtasks

### **7.1. Update Backend DTOs**

#### Implementation Guide:

```rust
File: tapp/backend/src/models/api/responses/order_book.rs

// Purpose: Add splits field to order book entry
// 
// Changes to ObEntryWithRoute:
//   - Keep: route_idx (backward compatibility)
//   - Add: splits: Option<Vec<Split>>
//
// New struct: Split
//   - route_idx: Which route to use
//   - amount: How much to swap on this route
//
// Example:
//   Phase 2.1: { routeIdx: 1, splits: None }
//   Phase 2.2: { routeIdx: 1, splits: [
//                  {routeIdx: 0, amount: "20"},
//                  {routeIdx: 1, amount: "30"},
//                  {routeIdx: 2, amount: "50"}
//                ]}

Backward compat: routeIdx still exists for Phase 2.1
```

**Deliverable:** Updated Rust DTOs

---

### **7.2. Backend Serialization**

#### Implementation Guide:

```rust
File: tapp/backend/src/utils/pool_route_utils.rs

// Purpose: Ensure build_order_book_with_splits() populates splits field
// 
// Output to Kafka must include:
//   - routeMatrix: Routes array (unchanged)
//   - entries: Array with splits field populated
//
// Example JSON output:
//   {
//     "routeMatrix": [[...], [...], [...]],
//     "entries": [
//       {
//         "amounts": ["100", "4850"],
//         "prices": [...],
//         "splits": [
//           {"routeIdx": 0, "amount": "20"},
//           {"routeIdx": 1, "amount": "80"}
//         ]
//       }
//     ]
//   }
```

**Deliverable:** Backend serializes splits correctly

---

### **7.3. Update Display Engine DTOs**

#### Implementation Guide:

```go
File: tapp-display-engine/internal/sc/dto.go

// Purpose: Mirror backend DTO changes in Go
// 
// Add to ObEntryWithRoute:
//   - Splits: []Split (new field)
//
// New struct: Split
//   - RouteIdx: int
//   - Amount: string
//
// JSON tags must match backend exactly!

Note: Display engine just passes data through (no logic change)
```

**Deliverable:** Go DTOs updated

---

### **7.4. Display Engine Handlers**

#### Implementation Guide:

```go
File: tapp-display-engine/internal/sc/sc.go

// Purpose: Ensure handlers pass splits through correctly
// 
// No logic changes needed!
//   - GetScEstSwap3: Parse from Kafka (splits included)
//   - OnEstSwap3Notification: Broadcast to WebSocket (splits included)
//
// Just verify: DTOs handle splits field automatically
```

**Deliverable:** Display engine handles splits

---

### **7.5. Testing**

#### Test Cases:

```bash
Test response format:
  ✅ Splits field present in response
  ✅ Splits sum to total amount (data integrity)
  ✅ routeIdx still exists (backward compat)
  ✅ JSON serialization correct

Test data flow:
  Backend → Kafka → Display Engine → WebSocket → Frontend
  Verify: splits field preserved through entire pipeline
```

**Deliverable:** Response format validated

---

## ✅ Definition of Done

- [ ] Backend DTOs updated
- [ ] Backend serialization working
- [ ] Display engine DTOs updated
- [ ] Display engine handlers updated
- [ ] Response format validated
- [ ] Data integrity checks pass
- [ ] Code reviewed

---

**Back to:** [Implementation Overview](../IMPLEMENTATION-TASKS-BREAKDOWN.md)

