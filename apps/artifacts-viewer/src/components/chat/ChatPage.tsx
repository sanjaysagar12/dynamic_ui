'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ROLES } from '@org/shared-types';
import { useSession } from '../../lib/session/session-context';
import { useArtifactCatalog } from '../../hooks/useArtifactCatalog';
import { useArtifactSrc } from '../../hooks/useArtifactSrc';
import { chatWithUnifiedAgent, UnifiedChatError } from '../../lib/api/unified-chat-client';
import { fetchSkills } from '../../lib/api/skills-client';
import type { ChatMessage } from '../../lib/chat/types';
import type { DbChatResponsePayload } from '../../lib/db-chat/types';
import type { ArtifactCatalogEntry } from '../../lib/artifacts/types';
import type { Skill } from '../../lib/skills/types';
import { ArtifactFrame } from '../ArtifactFrame';
import { AuthWidget } from '../auth/AuthWidget';
import { ChatMessageList } from './ChatMessageList';
import { ChatComposer } from './ChatComposer';
import { ExistingArtifactsPanel } from './ExistingArtifactsPanel';
import { SkillsPanel } from './SkillsPanel';
import { SkillSelector } from './SkillSelector';
import { DynamicForm } from '../db-chat/DynamicForm';
import { DynamicTable } from '../db-chat/DynamicTable';
import { DynamicChart } from '../db-chat/DynamicChart';
import { DynamicCard } from '../db-chat/DynamicCard';
import { theme, secondaryButtonStyle } from '../../lib/ui/theme';

// The last non-text database-agent response, if any — a form to fill in, or a structured result
// to render below the transcript. Cleared on the next send. Its own framing sentence (`text`, when
// present) is already part of `messages` (see db-agent-service's wrapDisplay/form_request
// handling), so this only ever needs to carry the structured part, not re-render the text itself.
type PendingRich = Extract<DbChatResponsePayload, { type: 'form_request' | 'table' | 'chart' | 'card' }>;

export function ChatPage() {
  const { session } = useSession();
  const token = session?.accessToken ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [urlPath, setUrlPath] = useState<string | null>(null);
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillsPanelOpen, setSkillsPanelOpen] = useState(false);
  const [pendingRich, setPendingRich] = useState<PendingRich | null>(null);

  const { artifacts, role } = useArtifactCatalog(token);
  const artifactSrc = useArtifactSrc(urlPath ?? '', token);

  const refreshSkills = useCallback(() => {
    fetchSkills()
      .then((result) => {
        setSkills(result);
        setSelectedSkills((current) => current.filter((name) => result.some((s) => s.name === name)));
      })
      .catch(() => setSkills([]));
  }, []);

  useEffect(() => {
    refreshSkills();
  }, [refreshSkills]);

  const handleSend = async (content: string) => {
    // Naming the skills explicitly in the message itself is more reliable
    // than relying on opencode to match the wording against each skill's
    // description on its own — and stays visible in the transcript, so
    // there's no hidden text the user can't see.
    const finalContent =
      selectedSkills.length > 0
        ? `Use these skills: ${selectedSkills.map((name) => `"${name}"`).join(', ')}. ${content}`
        : content;
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: finalContent }];
    setMessages(nextMessages);
    setPending(true);
    setError(null);
    setPendingRich(null);

    try {
      // The session's tool-service access token travels along on every turn
      // (as an Authorization header) even for what will turn out to be an
      // artifact request — the router only knows which agent handles a
      // message after this call reaches the server, and a database question
      // needs that token to have been sent at all.
      const result = await chatWithUnifiedAgent(
        {
          messages: nextMessages,
          slug,
          roles: ROLES.slice(),
        },
        token ?? undefined,
      );

      if (result.type === 'artifact') {
        setMessages(result.messages);
        setSlug(result.slug);
        setUrlPath(result.url_path);
        setPreviewSlug(result.slug);
        setPreviewReloadKey((k) => k + 1);
        return;
      }

      const response = result.response;
      setMessages(response.messages);
      if (response.type !== 'text') {
        setPendingRich(response);
      }
    } catch (err) {
      setError(err instanceof UnifiedChatError ? err.message : 'Failed to reach the agent service');
    } finally {
      setPending(false);
    }
  };

  const handleRead = (artifact: ArtifactCatalogEntry) => {
    setPreviewSlug(artifact.slug);
    setUrlPath(`/${artifact.slug}/`);
  };

  const handleEdit = (artifact: ArtifactCatalogEntry) => {
    setSlug(artifact.slug);
    setPreviewSlug(artifact.slug);
    setUrlPath(`/${artifact.slug}/`);
    setMessages([{ role: 'assistant', content: `Now editing "${artifact.title}". What would you like to change?` }]);
    setError(null);
    setPendingRich(null);
  };

  const handleNew = () => {
    setSlug(null);
    setPreviewSlug(null);
    setUrlPath(null);
    setMessages([]);
    setError(null);
    setPendingRich(null);
  };

  const isReadOnlyPreview = previewSlug !== null && previewSlug !== slug;

  return (
    <div style={{ display: 'flex', height: '100vh', background: theme.color.bg }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '380px',
          minWidth: '320px',
          borderRight: `1px solid ${theme.color.border}`,
          background: theme.color.surface,
        }}
      >
        <header style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem', borderBottom: `1px solid ${theme.color.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Link href="/" style={{ fontSize: '0.85rem', color: theme.color.textMuted, textDecoration: 'none' }}>
              ← Viewer
            </Link>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button type="button" onClick={() => setSkillsPanelOpen((v) => !v)} style={secondaryButtonStyle}>
                {skillsPanelOpen ? 'Hide skills' : 'Skills'}
              </button>
              <button type="button" onClick={handleNew} style={secondaryButtonStyle}>
                + New
              </button>
            </div>
          </div>
          <SkillSelector skills={skills} selected={selectedSkills} onChange={setSelectedSkills} />
          {slug && (
            <span style={{ fontSize: '0.8rem', color: theme.color.textMuted }}>
              Editing: <strong style={{ color: theme.color.text }}>{slug}</strong>
            </span>
          )}
        </header>

        {skillsPanelOpen && (
          <div style={{ padding: '0.85rem 1rem', borderBottom: `1px solid ${theme.color.border}`, overflowY: 'auto', maxHeight: '40vh' }}>
            <SkillsPanel skills={skills} onChange={refreshSkills} />
          </div>
        )}

        {token && !skillsPanelOpen && (
          <div style={{ padding: '0.85rem 1rem', borderBottom: `1px solid ${theme.color.border}`, overflowY: 'auto', maxHeight: '35vh' }}>
            <ExistingArtifactsPanel artifacts={artifacts} activeSlug={slug} onRead={handleRead} onEdit={handleEdit} />
          </div>
        )}

        <ChatMessageList messages={messages} pending={pending} />

        {pendingRich && (
          <div style={{ padding: '0 1rem 0.85rem', overflowY: 'auto', maxHeight: '45vh' }}>
            {pendingRich.type === 'form_request' && token && (
              <DynamicForm
                toolName={pendingRich.toolName}
                form={pendingRich.form}
                prefill={pendingRich.prefill}
                messages={messages}
                token={token}
                onDone={(nextMessages) => {
                  setMessages(nextMessages);
                  setPendingRich(null);
                }}
                onMessagesUpdate={setMessages}
                onCancel={() => setPendingRich(null)}
              />
            )}
            {pendingRich.type === 'table' && <DynamicTable display={pendingRich.display} rows={pendingRich.rows} />}
            {pendingRich.type === 'chart' && <DynamicChart display={pendingRich.display} rows={pendingRich.rows} />}
            {pendingRich.type === 'card' && <DynamicCard display={pendingRich.display} data={pendingRich.data} />}
          </div>
        )}

        {error && <p style={{ color: theme.color.danger, padding: '0 1rem', fontSize: '0.85rem' }}>{error}</p>}
        <ChatComposer disabled={pending} onSend={handleSend} />

        <div style={{ borderTop: `1px solid ${theme.color.border}`, padding: '0.85rem 1rem' }}>
          <AuthWidget role={role} popupPlacement="above" />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        {isReadOnlyPreview && (
          <p
            style={{
              padding: '0.6rem 1rem',
              margin: 0,
              background: '#fff8e1',
              borderBottom: `1px solid ${theme.color.border}`,
              fontSize: '0.85rem',
              color: '#92700c',
            }}
          >
            Read-only preview — click <strong>Edit</strong> on this artifact to modify it.
          </p>
        )}
        {artifactSrc && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              padding: '0.5rem 1rem',
              borderBottom: `1px solid ${theme.color.border}`,
            }}
          >
            <button type="button" onClick={() => setPreviewReloadKey((k) => k + 1)} style={secondaryButtonStyle}>
              ⟳ Refresh
            </button>
          </div>
        )}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {!token && (
            <p style={{ padding: '1.5rem', color: theme.color.textMuted }}>Log in to preview artifacts or ask database questions.</p>
          )}
          {token && !urlPath && (
            <p style={{ padding: '1.5rem', color: theme.color.textMuted }}>
              No artifact yet — start chatting to create one, or ask a question about your data.
            </p>
          )}
          {artifactSrc && (
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
              <ArtifactFrame src={artifactSrc} title={slug ?? 'artifact preview'} reloadNonce={previewReloadKey} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
