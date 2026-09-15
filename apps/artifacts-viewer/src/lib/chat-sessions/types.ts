import type { AgentType } from '../unified-chat/types';
import type { DbChatResponsePayload } from '../db-chat/types';

/** What the browser sends to `POST /api/chat` — see app/api/chat/route.ts. No more resending the
 *  full transcript: the server reconstructs it from persisted `ChatMessage` rows for `sessionId`. */
export interface ChatTurnRequestPayload {
  sessionId?: string;
  message: string;
}

/** One persisted turn, as returned by `GET /api/chat/sessions/[id]` and used to repaint the thread
 *  after loading a session from the sidebar. */
export interface ChatSessionMessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  route: AgentType | null;
  artifactSlug: string | null;
  createdAt: string;
}

/** A row in the sidebar's session list — `GET /api/chat/sessions`. */
export interface ChatSessionSummaryDto {
  id: string;
  title: string | null;
  updatedAt: string;
}

/** `GET /api/chat/sessions/[id]` — full history plus the artifact (if any) the session was last
 *  pointed at, so the preview pane can resume without re-deriving it client-side. */
export interface ChatSessionDetailDto {
  id: string;
  title: string | null;
  messages: ChatSessionMessageDto[];
  currentArtifactSlug: string | null;
}

export interface RenameChatSessionPayload {
  title: string;
}

/** `POST /api/chat`'s response. Carries the flat `{ sessionId, reply, route, artifactSlug }` shape
 *  plus the full underlying agent payload (`artifact`/`db`) so the existing rich rendering — the
 *  artifact preview pane, `DynamicTable`/`DynamicChart`/`DynamicCard`/`DynamicForm` — keeps working
 *  unchanged; only the transport (session-based, not full-history-per-turn) changed. */
export interface ChatTurnResponsePayload {
  sessionId: string;
  reply: string;
  route: AgentType;
  artifactSlug?: string;
  artifact?: { slug: string; title: string; urlPath: string; previewUrl: string };
  db?: DbChatResponsePayload;
}
