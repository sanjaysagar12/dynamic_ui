'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Role } from '@org/shared-auth';
import { useArtifactToken } from '../../hooks/useArtifactToken';
import { useArtifactCatalog } from '../../hooks/useArtifactCatalog';
import { buildArtifactUrl } from '../../lib/artifacts/artifact-url';
import { fetchProviders, sendChatMessage, ChatRequestError } from '../../lib/api/chat-client';
import type { ChatMessage, Provider, ProviderInfo } from '../../lib/chat/types';
import type { ArtifactCatalogEntry } from '../../lib/artifacts/types';
import { RoleSwitcher } from '../RoleSwitcher';
import { ArtifactFrame } from '../ArtifactFrame';
import { ProviderSelector } from './ProviderSelector';
import { ChatMessageList } from './ChatMessageList';
import { ChatComposer } from './ChatComposer';
import { ExistingArtifactsPanel } from './ExistingArtifactsPanel';

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [urlPath, setUrlPath] = useState<string | null>(null);
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  const [role, setRole] = useState<Role>('admin');
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState<Provider>('claude');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { token } = useArtifactToken(role);
  const { artifacts } = useArtifactCatalog(role);

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
  }, []);

  const handleSend = async (content: string) => {
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setPending(true);
    setError(null);

    try {
      const response = await sendChatMessage({
        messages: nextMessages,
        slug,
        roles: ['admin', 'manager'],
        provider,
      });
      setMessages(response.messages);
      setSlug(response.slug);
      setUrlPath(response.url_path);
      setPreviewSlug(response.slug);
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
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ display: 'flex', flexDirection: 'column', width: '35%', minWidth: '320px', borderRight: '1px solid #ddd' }}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem', borderBottom: '1px solid #ddd' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Link href="/">← Viewer</Link>
            <button type="button" onClick={handleNew}>
              + New
            </button>
          </div>
          <ProviderSelector providers={providers} provider={provider} onChange={setProvider} />
          {slug && (
            <span style={{ fontSize: '0.85rem', color: '#555' }}>
              Editing: <strong>{slug}</strong>
            </span>
          )}
          <ExistingArtifactsPanel artifacts={artifacts} activeSlug={slug} onRead={handleRead} onEdit={handleEdit} />
        </header>
        <ChatMessageList messages={messages} pending={pending} />
        {error && <p style={{ color: 'crimson', padding: '0 1rem' }}>{error}</p>}
        <ChatComposer disabled={pending} onSend={handleSend} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <header style={{ padding: '1rem', borderBottom: '1px solid #ddd' }}>
          <RoleSwitcher role={role} onChange={setRole} />
        </header>
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {!urlPath && <p style={{ padding: '1rem', color: '#888' }}>No artifact yet — start chatting to create one.</p>}
          {isReadOnlyPreview && (
            <p style={{ padding: '0.5rem 1rem', margin: 0, background: '#fffbe6', fontSize: '0.85rem' }}>
              Read-only preview — click <strong>Edit</strong> on this artifact to modify it.
            </p>
          )}
          {urlPath && token && (
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
              <ArtifactFrame src={buildArtifactUrl(urlPath, token)} title={slug ?? 'artifact preview'} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
