'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ROLES } from '@org/shared-auth';
import { useSupabaseSession } from '../../lib/supabase/supabase-session-context';
import { useArtifactCatalog } from '../../hooks/useArtifactCatalog';
import { useArtifactSrc } from '../../hooks/useArtifactSrc';
import { fetchProviders, sendChatMessage, ChatRequestError } from '../../lib/api/artifact-chat-client';
import { fetchSkills } from '../../lib/api/skills-client';
import type { ChatMessage, Provider, ProviderInfo } from '../../lib/chat/types';
import type { ArtifactCatalogEntry } from '../../lib/artifacts/types';
import type { Skill } from '../../lib/skills/types';
import { ArtifactFrame } from '../ArtifactFrame';
import { SupabaseSessionWidget } from '../supabase/SupabaseSessionWidget';
import { ProviderSelector } from './ProviderSelector';
import { ChatMessageList } from './ChatMessageList';
import { ChatComposer } from './ChatComposer';
import { ExistingArtifactsPanel } from './ExistingArtifactsPanel';
import { SkillsPanel } from './SkillsPanel';
import { SkillSelector } from './SkillSelector';
import { theme, secondaryButtonStyle } from '../../lib/ui/theme';

export function ChatPage() {
  const { session } = useSupabaseSession();
  const token = session?.accessToken ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [urlPath, setUrlPath] = useState<string | null>(null);
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState<Provider>('claude');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillsPanelOpen, setSkillsPanelOpen] = useState(false);

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
    fetchProviders()
      .then((res) => {
        setProviders(res.providers);
        setProvider(res.default);
      })
      .catch(() => {
        // Fall back to the built-in defaults if the agent service is unreachable.
        setProviders([
          { id: 'claude', label: 'Claude', model: 'claude-opus-4-8' },
          { id: 'gemini', label: 'Gemini', model: 'gemini-2.5-flash' },
        ]);
      });
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

    try {
      const response = await sendChatMessage({
        messages: nextMessages,
        slug,
        roles: ROLES.slice(),
        provider,
      });
      setMessages(response.messages);
      setSlug(response.slug);
      setUrlPath(response.url_path);
      setPreviewSlug(response.slug);
      setPreviewReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof ChatRequestError ? err.message : 'Failed to reach the agent service');
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
  };

  const handleNew = () => {
    setSlug(null);
    setPreviewSlug(null);
    setUrlPath(null);
    setMessages([]);
    setError(null);
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
            <Link href="/db-chat" style={{ fontSize: '0.85rem', color: theme.color.primary, textDecoration: 'none' }}>
              Database Chat →
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
          <ProviderSelector providers={providers} provider={provider} onChange={setProvider} />
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
        {error && <p style={{ color: theme.color.danger, padding: '0 1rem', fontSize: '0.85rem' }}>{error}</p>}
        <ChatComposer disabled={pending} onSend={handleSend} />

        <div style={{ borderTop: `1px solid ${theme.color.border}`, padding: '0.85rem 1rem' }}>
          <SupabaseSessionWidget role={role} popupPlacement="above" />
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
            <p style={{ padding: '1.5rem', color: theme.color.textMuted }}>Log in with Supabase to preview artifacts.</p>
          )}
          {token && !urlPath && (
            <p style={{ padding: '1.5rem', color: theme.color.textMuted }}>No artifact yet — start chatting to create one.</p>
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
