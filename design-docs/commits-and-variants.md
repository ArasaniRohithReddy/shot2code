# Commits and Non-Blocking Variants

This document explains how the commit system and non-blocking variant generation work in shot2code.

## Commit System

### What are Commits?

Commits represent discrete versions in the application's history. Each commit contains:

- **Hash**: Unique identifier (generated using `nanoid()`)
- **Parent Hash**: Links to previous commit for history tracking
- **Variants**: Multiple code generation options (typically 2)
- **Selected Variant**: Which variant the user is currently viewing
- **Status**: Whether the commit is still being edited (`isCommitted: false`) or finalized (`isCommitted: true`)

### Commit Types

```typescript
type CommitType = "ai_create" | "ai_edit" | "code_create";
```

- **ai_create**: Initial generation from screenshot/video
- **ai_edit**: Updates based on user instructions
- **code_create**: Import from existing code

### Data Structure

```typescript
type Commit = {
  hash: CommitHash;
  parentHash: CommitHash | null;
  dateCreated: Date;
  isCommitted: boolean;
  variants: Variant[];
  selectedVariantIndex: number;
  type: CommitType;
  inputs: any; // Type-specific inputs
}

type Variant = {
  code: string;
  status: VariantStatus;
}

type VariantStatus = "generating" | "complete" | "cancelled";
```

### Storage and Management

Commits are stored in the project store as a flat record:

```typescript
commits: Record<CommitHash, Commit>
head: CommitHash | null  // Current active commit
```

The `head` pointer tracks which commit is currently active. History is reconstructed by following `parentHash` links.

## Non-Blocking Variants

### Traditional Variant Generation (Before)

```
Start Generation → Wait for ALL variants → Show results
User Experience: [Loading...........................] → Ready
```

Problems:
- Users wait for the slowest variant
- No interaction until everything completes
- Poor perceived performance

### Non-Blocking Variant Generation (After)

```
Start Generation → Show results as each variant completes
User Experience: [Loading.....] → Ready (Option 1)
                 [Loading..........] → Ready (Option 2)
```

Benefits:
- Immediate interaction when first variant completes
- Can switch between completed variants while others generate
- Significantly improved perceived performance

### Implementation Overview

#### Frontend Changes

**App.tsx**: Enhanced event handling
```typescript
// New WebSocket events
onVariantComplete: (variantIndex) => {
  updateVariantStatus(commit.hash, variantIndex, 'complete');
}
onVariantError: (variantIndex, error) => {
  updateVariantStatus(commit.hash, variantIndex, 'cancelled');
}
```

**Sidebar.tsx**: Dual-condition UI
```typescript
// Show update UI when either condition is true
{(appState === AppState.CODE_READY || isSelectedVariantComplete) && (
  <UpdateInterface />
)}
```

**Variants.tsx**: Real-time status indicators
- Green dot: Complete variants
- Red dot: Cancelled variants  
- Spinner: Currently generating variants

#### Backend Changes

**generate_code.py**: Independent variant processing
```python
# Process each variant independently
async def process_variant_completion(index: int, task: asyncio.Task):
    completion = await task  # Wait for THIS variant only
    
    # Process images immediately
    processed_html = await perform_image_generation(...)
    
    # Send to frontend immediately
    await send_message("setCode", processed_html, index)
    await send_message("variantComplete", "Variant generation complete", index)
```

### State Management

#### App State vs Variant Status

The system uses a **hybrid state approach**:

- **AppState**: Global generation status (`INITIAL` → `CODING` → `CODE_READY`)
- **Variant Status**: Individual variant status (`generating` → `complete`/`error`/`cancelled`)

#### UI Logic

```typescript
const selectedVariant = commit.variants[commit.selectedVariantIndex];
const canUpdate = selectedVariant?.status === "complete";
```

The update composer follows the selected variant rather than the global app state or a fixed option count. Any completed option can be edited immediately, including option 3 and later options, while generating, failed, and cancelled options keep the composer unavailable.

### WebSocket Protocol

#### Events from Backend

```typescript
type WebSocketResponse = {
  type: "chunk" | "status" | "setCode" | "variantComplete" | "variantError";
  value: string;
  variantIndex: number;
}
```

- **chunk**: Streaming code content during generation
- **status**: Status updates (e.g., "Generating images...")
- **setCode**: Final code for a variant
- **variantComplete**: Variant finished successfully
- **variantError**: Variant failed with error

#### Event Flow

```
Backend: Generate Variant 1 → "setCode" → "variantComplete"
Frontend: Update UI → Allow interaction

Backend: Generate Variant 2 → "setCode" → "variantComplete"  
Frontend: Update UI → User can switch to this variant

Backend: Generate Variant 3 → "variantError"
Frontend: Show error → Mark as cancelled
```

### User Experience Flow

1. **User starts generation**
   - All variants marked as `status: "generating"`
   - UI shows loading state with spinners

2. **First variant completes**
   - Receives `variantComplete` event
   - Status updated to `"complete"`
   - If this is the selected variant → UI immediately allows updates
   - User can start editing while other variants generate

3. **User switches variants**
   - Can switch to any completed variant immediately
   - Can switch to generating variants (will show loading until complete)

4. **User starts update**
   - Automatically cancels all other generating variants
   - Prevents wasted computation

### Benefits

1. **Perceived Performance**: Users see results 2-3x faster
2. **Parallel Processing**: Multiple models generate simultaneously
3. **Flexible Interaction**: Switch between ready options while others work
4. **Resource Efficiency**: Cancel unused variants when user makes changes
5. **Graceful Degradation**: System works even if some variants fail

### Technical Considerations

#### Variant Cancellation

When users start updates, other generating variants are cancelled:

```typescript
// Cancel generating variants when user updates
currentCommit.variants.forEach((variant, index) => {
  if (index !== selectedVariantIndex && variant.status === 'generating') {
    wsRef.current.send(JSON.stringify({
      type: "cancel_variant",
      variantIndex: index
    }));
  }
});
```

#### Error Handling

Each variant handles errors independently:
- Failed variants don't block successful ones
- Users see specific error messages per variant
- System remains functional if some variants fail

#### WebSocket Lifecycle

- New generations replace previous WebSocket connections
- Previous connections are closed to prevent resource leaks
- Backend handles connection state checking before sending messages

This architecture enables a responsive, non-blocking user experience while maintaining system reliability and resource efficiency.


## Desktop persistence

The frontend mirrors project state into the desktop-local SQLite history API.
Each project receives a stable ID and stores its title, stack, input mode,
initial prompt, screenshot interpretation, and shared prompt-asset registry.
Prompt and chat records reference asset IDs; large image and video data URLs are
stored once in project metadata instead of being repeated in every message.

SQLite versions are append-only. The current editable commit therefore remains
a `draft_commit` in project metadata. When a newer commit starts, the previous
draft is promoted to an immutable version in the same project-snapshot
transaction that stores the new draft. This preserves the existing editor rule
that only the latest commit is mutable without weakening database immutability.

Persistence occurs immediately for project creation, generation/status/final
milestones, and commit/variant/file selection. Streaming code and editor changes
use a trailing debounce, so token events do not produce one database write per
token. Failed and partially completed variants retain their code, files, status,
model, error, chat history, and agent activity. A draft restored after an app
restart converts any still-generating variants to interrupted/cancelled state,
because their original WebSocket no longer exists.

Retry is append-only. Each retry receives a new commit ID whose `parent_commit_id`
and `retry_of_commit_id` both identify the selected source attempt. Replay context
separately records the original content base and option, input mode, stack, model
selection, asset-extraction choice, and composed design context. This lets a retry
of a retry reproduce the same request without applying an edit twice. Starting a
retry immediately promotes any prior draft and stores the new retry draft in one
project-snapshot transaction. Failed or cancelled retries remain navigable, and
the Versions UI links both `Retried from vN` and every `Retried as vN` descendant.
Historical versions keep their option-specific files and chat histories selectable
without rewriting the immutable SQLite version.

The start pane lists recent local projects and supports open, delete (with a
confirmation), and new-project actions. Electron remembers the active project
and restores it on restart; choosing New records that intent so a later restart
does not reopen an older project unexpectedly. History API failures are shown to
the user but never block the in-memory editing workflow.
