# Variant System

## Overview

The variant system generates multiple code options in parallel, allowing users to compare different AI-generated implementations. The system defaults to 3 variants and scales automatically by changing `NUM_VARIANTS` in config.

## Configuration

**Key Setting:** `NUM_VARIANTS = 3` in `backend/config.py`

Changing this value automatically scales the entire system to support any number of variants.

## Model Selection

A run's models come from one of three places, checked in this order:

1. **Retry.** `retryModels` replays the exact lineup the original run used, so
   the earlier result can be reproduced. It is never re-filtered.
2. **Explicit picks.** `selectedModels` (any provider; older clients send the
   same list as `copilotModels`) produces **one variant per selected model**,
   capped by the per-run limit. Picks whose provider has no credential, whose
   Copilot plan no longer lists them, or which cannot read video in video mode
   are dropped and reported to the client through the `variantModels` message.
3. **Automatic.** With no picks, the lineup comes from
   `backend/routes/model_choice_sets.py` based on which providers are available,
   cycling to fill the limit: models `[A, B]` with a limit of 5 become
   `[A, B, A, B, A]`.

**Variant limits** (`variant_limit` in `generate_code.py`): 4 for a create, 2
for an update, 2 for video.

**Availability** comes from `backend/model_catalog.py`, which combines live
Copilot discovery with the maintained per-provider tables in `llm.py` and the
credentials supplied with the request. The same catalog backs `GET`/`POST`
`/api/models`, which the frontend pickers read.

## Frontend

### Grid Layouts
- **2 variants**: 2-column 
- **3 variants**: 2-column (third wraps below - prevents squishing)
- **4 variants**: 2x2 grid  
- **5-6 variants**: 3-column 
- **7+ variants**: 4-column

### Keyboard Shortcuts
- **Option/Alt + 1, 2, 3...**: Switch variants
- Works globally, even in text fields
- Uses `event.code` for cross-platform compatibility
- Visual indicators show ⌥1, ⌥2, ⌥3

## Architecture

### Backend
- `StatusBroadcastMiddleware` sends the planned `variantCount` to the frontend;
  `CodeGenerationMiddleware` corrects it if stale picks shrink the run
- `ModelSelectionStage` resolves retry / explicit / automatic selection
- `model_catalog.py` decides which providers and models are selectable
- Pipeline generates variants in parallel via WebSocket

### Frontend  
- Learns variant count from backend dynamically
- `resizeVariants()` adapts UI to backend count
- Error handling per variant with status display

## WebSocket Messages

```typescript
"variantCount" | "variantModels" | "chunk" | "status" | "setCode" | "variantComplete" | "variantError"
```

`variantModels` carries `{ models, droppedModels?, notice? }`. The notice
explains any pick that was skipped, so a shorter-than-expected option list is
never unexplained.

## Implementation Notes

✅ **Scalable**: Change `NUM_VARIANTS` and everything adapts  
✅ **Cross-platform**: Keyboard shortcuts work Mac/Windows  
✅ **Responsive**: Grid layouts adapt to count  
✅ **Simple**: Model cycling handles any variant count  

## Key Files

- `backend/config.py` - NUM_VARIANTS setting
- `backend/model_catalog.py` - provider availability and the selectable catalog
- `backend/routes/models.py` - `/api/models`, read by the frontend pickers
- `backend/routes/generate_code.py` - Model selection pipeline  
- `frontend/src/lib/model-selection.ts` - catalog helpers, migration, planning
- `frontend/src/components/settings/ModelCatalogPicker.tsx` - shared picker UI
- `frontend/src/components/variants/Variants.tsx` - UI and shortcuts
- `frontend/src/store/project-store.ts` - State management
