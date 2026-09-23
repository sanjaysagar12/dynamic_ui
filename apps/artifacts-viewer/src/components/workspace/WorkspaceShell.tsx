'use client';

import { useMemo, useState } from 'react';
import { useSession } from '../../lib/session/session-context';
import { useArtifactCatalog } from '../../hooks/useArtifactCatalog';
import { chatWithUnifiedAgent, UnifiedChatError } from '../../lib/api/unified-chat-client';
import type { DbChatResponsePayload } from '../../lib/db-chat/types';
import type { DisplayMessage } from '../chat/MessageBubble';
import { Sidebar } from '../sidebar/Sidebar';
import { TopBar } from './TopBar';
import { AssistantPage } from './AssistantPage';
import { ChatPopup } from './ChatPopup';
import { ArtifactCanvasPanel } from './ArtifactCanvasPanel';

type PendingRich = Extract<DbChatResponsePayload, { type: 'form_request' | 'table' | 'chart' | 'card' }>;

interface ActiveArtifact {
  slug: string;
  title: string;
  urlPath: string;
}

export function WorkspaceShell() {
  const { session, logout } = useSession();
  const token = session?.accessToken ?? null;
  const { artifacts } = useArtifactCatalog(token);
  const artifactTitles = useMemo(() => Object.fromEntries(artifacts.map((a) => [a.slug, a.title])), [artifacts]);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [activeArtifact, setActiveArtifact] = useState<ActiveArtifact | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRich, setPendingRich] = useState<PendingRich | null>(null);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [chatOpen, setChatOpen] = useState(false);

  const handleSend = async (content: string) => {
    if (!token) return;
    const finalContent =
      selectedSkills.length > 0 ? `Use these skills: ${selectedSkills.map((name) => `"${name}"`).join(', ')}. ${content}` : content;

    setMessages((current) => [...current, { role: 'user', content: finalContent }]);
    setPending(true);
    setError(null);
    setPendingRich(null);

    try {
      const result = await chatWithUnifiedAgent({ sessionId: sessionId ?? undefined, message: finalContent }, token);
      setSessionId(result.sessionId);
      setMessages((current) => [...current, { role: 'assistant', content: result.reply, artifactSlug: result.artifactSlug ?? null }]);

      if (result.route === 'artifact' && result.artifact) {
        setActiveArtifact({ slug: result.artifact.slug, title: result.artifact.title, urlPath: result.artifact.urlPath });
        setPreviewReloadKey((k) => k + 1);
        // Surfaces the reply the moment the page appears — the user can close the drawer
        // themselves once they've seen it, to get the full page back.
        setChatOpen(true);
      } else if (result.route === 'db' && result.db && result.db.type !== 'text') {
        setPendingRich(result.db);
      }
    } catch (err) {
      setError(err instanceof UnifiedChatError ? err.message : 'Failed to reach the agent service');
    } finally {
      setPending(false);
    }
  };

  const handleSelectArtifact = (slug: string) => {
    // One shared assistant conversation for the whole workspace (new-prompt.md §5) — switching
    // which page is open never resets or forks the conversation, it just changes what the
    // canvas/floating panel is currently scoped to.
    setActiveArtifact({ slug, title: artifactTitles[slug] ?? slug, urlPath: `/${slug}/` });
    setPreviewReloadKey((k) => k + 1);
    setChatOpen(false);
  };

  const handleSelectAssistant = () => {
    setActiveArtifact(null);
    setChatOpen(false);
  };

  const handleOpenArtifact = (slug: string) => {
    setActiveArtifact({ slug, title: artifactTitles[slug] ?? slug, urlPath: `/${slug}/` });
    setPreviewReloadKey((k) => k + 1);
    setChatOpen(false);
  };

  if (!token || !session) return null;

  const hasActiveArtifact = activeArtifact !== null;
  const pageTitle = activeArtifact?.title ?? 'AI Assistant';

  return (
    <div className="flex h-screen bg-app overflow-hidden">
      <Sidebar
        activeArtifactSlug={activeArtifact?.slug ?? null}
        isAssistantActive={!hasActiveArtifact}
        onSelectArtifact={handleSelectArtifact}
        onSelectAssistant={handleSelectAssistant}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          workspaceName="Dynamic UI"
          pageTitle={pageTitle}
          userEmail={session.email}
          userRole={session.role}
          onLogout={logout}
        />

        <div className="flex-1 min-h-0 relative flex flex-col">
          {!hasActiveArtifact ? (
            <AssistantPage
              messages={messages}
              pending={pending}
              error={error}
              pendingRich={pendingRich}
              token={token}
              sessionId={sessionId ?? undefined}
              artifactTitles={artifactTitles}
              selectedSkills={selectedSkills}
              onSelectedSkillsChange={setSelectedSkills}
              onSend={handleSend}
              onOpenArtifact={handleOpenArtifact}
              onFormDone={(next) => {
                setMessages(next);
                setPendingRich(null);
              }}
              onFormMessagesUpdate={setMessages}
              onFormCancel={() => setPendingRich(null)}
            />
          ) : (
            <>
              <ArtifactCanvasPanel
                title={activeArtifact.title}
                urlPath={activeArtifact.urlPath}
                token={token}
                generating={pending}
                reloadKey={previewReloadKey}
              />

              <ChatPopup
                open={chatOpen}
                onOpenChange={setChatOpen}
                pageTitle={activeArtifact.title}
                messages={messages}
                pending={pending}
                error={error}
                pendingRich={pendingRich}
                token={token}
                sessionId={sessionId ?? undefined}
                artifactTitles={artifactTitles}
                selectedSkills={selectedSkills}
                onSelectedSkillsChange={setSelectedSkills}
                onSend={handleSend}
                onOpenArtifact={handleOpenArtifact}
                onFormDone={(next) => {
                  setMessages(next);
                  setPendingRich(null);
                }}
                onFormMessagesUpdate={setMessages}
                onFormCancel={() => setPendingRich(null)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
