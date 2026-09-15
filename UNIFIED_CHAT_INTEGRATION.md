# Unified Chat Integration Documentation

## Overview
This document describes the integration of separate chat-artifact and chat-db endpoints into a single unified chat endpoint that intelligently routes requests to the appropriate agent.

## Architecture

### New Files Created

1. **`apps/artifacts-viewer/src/lib/unified-chat/types.ts`**
   - Defines unified chat types: `UnifiedChatRequestPayload`, `UnifiedChatResponsePayload`
   - Exports `AgentType` enum: `'artifact' | 'db'`
   - Combines responses from both artifact and db agents

2. **`apps/artifacts-viewer/src/lib/unified-chat/agent-router.ts`**
   - Core routing logic that determines which agent to use based on user prompt
   - Uses Claude Opus-5 LLM for intelligent intent analysis
   - Analyzes user message to determine:
     - **Artifact Intent**: Create, generate, or design visual content (UI components, dashboards, charts, HTML, React components, layouts, visualizations)
     - **Database Intent**: Query, insert, update, delete, or manipulate data (fetch data, select records, modify entries, manage databases)
   - Defaults to DB agent on API errors (graceful fallback)

3. **`apps/artifacts-viewer/src/app/api/chat/route.ts`**
   - New unified endpoint: `POST /api/chat`
   - Automatically routes to `/api/chat-artifact` or `/api/chat-db` based on intent
   - Handles authentication (Bearer token required for DB operations)
   - Comprehensive error handling for both agent types

4. **`apps/artifacts-viewer/src/lib/api/unified-chat-client.ts`**
   - Client library for consuming the unified chat endpoint
   - Handles request serialization and response parsing
   - Supports optional access token for DB operations
   - Timeout: 950 seconds (artifact operations can take longer)

5. **`apps/artifacts-viewer/src/lib/unified-chat/agent-router.spec.ts`**
   - Comprehensive test suite for the router (17 tests, all passing)
   - Tests artifact routing, DB routing, and edge cases

## Routing Logic

### Artifact Agent Routes To:
- "Create a React component..." → **artifact**
- "Generate a dashboard..." → **artifact**
- "Design a landing page..." → **artifact**
- "Build an interactive form..." → **artifact**

### Database Agent Routes To:
- "Select all users..." → **db**
- "Insert a new record..." → **db**
- "Update inventory..." → **db**
- "List all customers..." → **db**
- "Count total orders..." → **db**

### Routing Strategy:
- Uses Claude Opus-5 LLM for intelligent analysis
- No hardcoded keywords or scoring system
- Natural language understanding of user intent
- Graceful fallback to **db** agent on API errors
- LLM evaluation is invisible to the user

## Request/Response Flow

```
Client Browser
    ↓
/api/chat (Unified Endpoint)
    ↓
Agent Router (LLM Analysis)
    │ Calls Claude Opus-5 to determine intent
    │
    ├→ Artifact Intent → Artifact Agent (/api/chat-artifact)
    │   └→ Returns: ChatResponsePayload
    │
    └→ Database Intent → DB Agent (/api/chat-db)
        └→ Returns: DbChatResponsePayload
    ↓
Unified Response Format (type: 'artifact' | 'db')
    ↓
Client Browser
```

## Type Safety

### UnifiedChatRequestPayload
```typescript
{
  messages: ChatMessage[];
  slug?: string | null;
  roles?: Role[];
}
```

### UnifiedChatResponsePayload (Discriminated Union)
```typescript
type UnifiedChatResponsePayload = 
  | (ChatResponsePayload & { type: 'artifact' })
  | { type: 'db'; response: DbChatResponsePayload; agentType: 'db' };
```

## Usage Examples

### From Frontend (TypeScript/React)
```typescript
import { chatWithUnifiedAgent } from '@/lib/api/unified-chat-client';

// Artifact generation (no token needed)
const artifactResponse = await chatWithUnifiedAgent({
  messages: [{ role: 'user', content: 'Create a React dashboard' }],
  roles: [],
});

if (artifactResponse.type === 'artifact') {
  // Handle artifact response
}

// Data manipulation (token required)
const dbResponse = await chatWithUnifiedAgent({
  messages: [{ role: 'user', content: 'Show me all users' }],
}, accessToken);

if (dbResponse.type === 'db') {
  // Handle DB response
}
```

## Backward Compatibility

The existing endpoints remain unchanged:
- ✅ `/api/chat-artifact` - Still works independently
- ✅ `/api/chat-db` - Still works independently
- ✅ Both can be called directly if needed
- ✅ New `/api/chat` endpoint is optional for new clients

## Testing

### Unit Tests
```bash
npm exec nx test artifacts-viewer -- agent-router.spec.ts
```

**Results**: ✅ 17 tests passed
- Artifact routing: 5 tests
- DB routing: 6 tests
- Edge cases: 6 tests

### Build Verification
```bash
npm exec nx build artifacts-viewer
```

**Results**: ✅ Build successful
- All routes properly compiled
- No TypeScript errors
- No missing dependencies

## Verification Checklist

- [x] Agent router logic implemented and tested (17 tests passing)
- [x] Unified chat endpoint created at `/api/chat`
- [x] Type definitions for unified request/response
- [x] Client library for consuming unified endpoint
- [x] Proper error handling for both agent types
- [x] Authentication handling for DB operations
- [x] Build compilation successful
- [x] No TypeScript errors
- [x] Backward compatibility maintained
- [x] No git merge conflicts

## Performance Notes

- Artifact agent timeout: 950,000ms (for complex multi-screen artifacts)
- DB agent timeout: 60,000ms (for standard queries)
- Router decision time: ~1-2 seconds (Claude LLM inference)
- LLM routing is cached by Anthropic where possible
- All existing optimizations preserved

## Future Improvements

1. **Confidence Scoring**: Return confidence level from Claude routing decision
2. **User Feedback Loop**: Learn from misrouted requests and fine-tune prompts
3. **Analytics**: Track routing decisions, latency, and agent performance
4. **Cached Intent Analysis**: Cache routing decisions for identical or similar prompts
5. **Custom Routing Rules**: Allow per-deployment overrides or specialized routing strategies
6. **Routing Explanation**: Include "reasoning" from Claude to show why a route was chosen

## Security Considerations

- ✅ Bearer token validation for DB operations
- ✅ Separate error handling per agent type
- ✅ No credential leakage in error messages
- ✅ Proper HTTP status codes (401 for auth failures)
- ✅ Input validation before routing

## Migration Guide

### Option 1: Use New Unified Endpoint (Recommended)
```typescript
// Old
POST /api/chat-artifact or /api/chat-db

// New
POST /api/chat (auto-routes based on intent)
```

### Option 2: Keep Using Old Endpoints
No changes needed - existing code continues to work.
