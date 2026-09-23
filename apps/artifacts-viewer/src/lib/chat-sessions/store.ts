import 'server-only';
import { prisma } from '../db/prisma';
import type { ChatSession } from '../../generated/prisma-client';
import type { AgentType } from '../unified-chat/types';

const TITLE_MAX_LENGTH = 50;

function deriveTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim();
  return trimmed.length > TITLE_MAX_LENGTH ? `${trimmed.slice(0, TITLE_MAX_LENGTH)}…` : trimmed;
}

export async function getSessionById(sessionId: string): Promise<ChatSession | null> {
  return prisma.chatSession.findUnique({ where: { id: sessionId } });
}

export async function createSession(userId: string, firstMessage: string): Promise<ChatSession> {
  return prisma.chatSession.create({ data: { userId, title: deriveTitle(firstMessage) } });
}

export async function listSessionsForUser(userId: string) {
  return prisma.chatSession.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, updatedAt: true },
  });
}

/** Chronological `{ role, content }` history, exactly the shape both backend agents expect. */
export async function getMessageHistory(sessionId: string): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });
  return rows.map((row) => ({ role: row.role as 'user' | 'assistant', content: row.content }));
}

export async function getFullHistory(sessionId: string) {
  return prisma.chatMessage.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
}

/** The artifact currently being edited in this session, if any — the most recent
 *  artifact-routed message that actually produced one. Mirrors the pre-persistence UI's own
 *  client-side `slug` state, but derived server-side from history instead of held across turns. */
export async function getCurrentArtifactSlug(sessionId: string): Promise<string | null> {
  const last = await prisma.chatMessage.findFirst({
    where: { sessionId, route: 'artifact', artifactSlug: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { artifactSlug: true },
  });
  return last?.artifactSlug ?? null;
}

/** Which agent answered the most recent assistant message in this session, if any. The router
 *  uses it to send short follow-ups ("yes", "100", "make it bigger") to the same agent. */
export async function getLastRoute(sessionId: string): Promise<AgentType | undefined> {
  const last = await prisma.chatMessage.findFirst({
    where: { sessionId, role: 'assistant', route: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { route: true },
  });
  return (last?.route as AgentType | null) ?? undefined;
}

export async function appendMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  extra?: { route?: AgentType; artifactSlug?: string },
) {
  const [message] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: { sessionId, role, content, route: extra?.route ?? null, artifactSlug: extra?.artifactSlug ?? null },
    }),
    // ChatMessage is a separate row, so creating one doesn't itself bump ChatSession.updatedAt —
    // touch it explicitly so the sidebar's "most recently active first" ordering reflects real usage.
    prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } }),
  ]);
  return message;
}

export async function renameSession(sessionId: string, title: string): Promise<ChatSession> {
  return prisma.chatSession.update({ where: { id: sessionId }, data: { title } });
}

export async function deleteSession(sessionId: string): Promise<void> {
  // ChatMessage rows cascade via the FK's onDelete: Cascade (see schema.prisma).
  await prisma.chatSession.delete({ where: { id: sessionId } });
}
