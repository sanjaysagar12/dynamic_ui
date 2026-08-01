import { mkdirSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { PROVIDER_MODEL_PREFIX, type AppConfig, type Provider } from '../config.js';
import type { ChatMessage, ChatRequest, ChatResponse } from '../schemas.js';
import { readTitle, writeManifest } from './manifest.js';
import { OpenCodeRunner } from './opencode-runner.js';
import { slugify, titleFromSlug, uniqueSlug } from './slug.js';

function renderTranscript(messages: ChatMessage[]): string {
  return messages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
}

function toUrlPath(slug: string): string {
  const normalized = slug.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return `/${normalized}/`;
}

function listFilesWritten(artifactDir: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile() && entry !== 'manifest.json') {
        results.push(relative(artifactDir, fullPath).split(sep).join('/'));
      }
    }
  }

  walk(artifactDir);
  return results.sort();
}

export class ChatArtifactService {
  // In-memory, process-lifetime map of artifact slug -> opencode session id.
  private static readonly sessions = new Map<string, string>();

  private readonly opencode: OpenCodeRunner;

  constructor(private readonly config: AppConfig) {
    this.opencode = new OpenCodeRunner(config.opencodeBin, config.opencodeTimeoutMs);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const provider = (request.provider || this.config.defaultProvider) as Provider;
    const modelName = request.model || (provider === 'claude' ? this.config.anthropicModel : this.config.geminiModel);
    const model = `${PROVIDER_MODEL_PREFIX[provider]}/${modelName}`;

    const isNew = request.slug == null;
    const slug = request.slug || uniqueSlug(slugify(request.messages[0].content), this.config.artifactsRoot);
    const artifactDir = join(this.config.artifactsRoot, slug);
    mkdirSync(artifactDir, { recursive: true });

    const sessionId = ChatArtifactService.sessions.get(slug) ?? null;
    // When continuing a live opencode session, it already has the prior
    // turns in its own history — resending the full reconstructed
    // transcript on top of that duplicates/conflicts with what it
    // remembers (confirmed: it makes the model re-validate the original
    // request instead of applying the newest one). Only reconstruct full
    // history as a fallback when there's no session to continue.
    const prompt = sessionId ? request.messages[request.messages.length - 1].content : renderTranscript(request.messages);

    const result = await this.opencode.run(artifactDir, prompt, model, sessionId);
    if (result.sessionId) {
      ChatArtifactService.sessions.set(slug, result.sessionId);
    }

    const title = isNew ? titleFromSlug(slug) : readTitle(artifactDir) || titleFromSlug(slug);
    writeManifest(artifactDir, request.roles, title);

    const filesWritten = listFilesWritten(artifactDir);
    const urlPath = toUrlPath(slug);

    return {
      reply: result.reply,
      slug,
      title,
      roles: request.roles,
      url_path: urlPath,
      preview_url: `${this.config.artifactsServerUrl.replace(/\/+$/, '')}${urlPath}`,
      files_written: filesWritten,
      provider,
      messages: [...request.messages, { role: 'assistant', content: result.reply }],
    };
  }
}
