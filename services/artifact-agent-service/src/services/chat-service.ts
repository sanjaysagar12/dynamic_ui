import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { OPENCODE_MODEL, type AppConfig } from '../config.js';
import type { ChatMessage, ChatRequest, ChatResponse } from '../schemas.js';
import { readTitle, writeManifest } from './manifest.js';
import { ArtifactGenerationError, OpenCodeRunner } from './opencode-runner.js';
import { slugify, titleFromSlug, uniqueSlug } from './slug.js';

const INDEX_FILE = 'index.html';

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
    const isNew = request.slug == null;
    const latestMessage = request.messages[request.messages.length - 1].content;
    // `request.messages` is the CALLER's whole chat session history, not this artifact's own
    // conversation — apps/artifacts-viewer's /api/chat sends the same session-wide transcript
    // regardless of route, so a session that ever asked a database question before asking for
    // this screen carries that unrelated exchange right along with it. A brand-new artifact has
    // no prior turns of its own to continue, so its slug (and prompt, below) must come from the
    // message that's actually asking for it — the latest one — never messages[0], which is
    // whatever the session's very first message happened to be, on-topic or not.
    const slug = request.slug || uniqueSlug(slugify(latestMessage), this.config.artifactsRoot);
    const artifactDir = join(this.config.artifactsRoot, slug);
    mkdirSync(artifactDir, { recursive: true });

    // The cached sessionId is only trustworthy if this slug's directory still actually has the
    // content that session built. Nothing keeps them in sync automatically: deleting an artifact
    // happens in artifacts-server, a completely separate process with no way to tell this one to
    // forget its cached session, and slugify() truncates to 40 chars, so two differently-worded
    // prompts can collide on the same base slug after a delete. Trusting a stale sessionId against
    // a directory that doesn't match it is exactly what confuses opencode into treating the new
    // request as belonging to a page it no longer has ("this is a new, distinct page... I'll
    // create it as its own artifact") without actually writing one — reproduced live. A missing
    // index.html means whatever this slug remembers is gone (or never existed); always start over.
    const hasExistingContent = existsSync(join(artifactDir, INDEX_FILE));
    if (!hasExistingContent) {
      ChatArtifactService.sessions.delete(slug);
    }
    const sessionId = hasExistingContent ? (ChatArtifactService.sessions.get(slug) ?? null) : null;
    // When continuing a live opencode session, it already has the prior turns in its own
    // history — resending a reconstructed transcript on top of that duplicates/conflicts with
    // what it remembers (confirmed: it makes the model re-validate the original request instead
    // of applying the newest one). A brand-new artifact has nothing to continue either way — only
    // the message asking for it. Only an existing artifact whose live opencode session was lost
    // (e.g. a service restart) falls back to the full reconstructed transcript, best-effort.
    const prompt = sessionId || isNew ? latestMessage : renderTranscript(request.messages);

    let result;
    try {
      result = await this.opencode.run(artifactDir, prompt, OPENCODE_MODEL, sessionId);
    } catch (err) {
      // A brand-new artifact directory was just mkdir'd above and opencode never got to (or
      // never finished) writing anything real into it — leaving it behind is pure litter: it
      // shows up in a raw directory listing, and uniqueSlug() would treat its slug as
      // permanently taken. A CONTINUING artifact (isNew false) keeps whatever it already had
      // from earlier successful turns — this failed edit attempt doesn't get to delete it.
      if (isNew) rmSync(artifactDir, { recursive: true, force: true });
      throw err;
    }
    if (result.sessionId) {
      ChatArtifactService.sessions.set(slug, result.sessionId);
    }

    // artifacts-server refuses to serve a directory with no index.html (ArtifactPathResolver) —
    // so that's the one thing that actually makes this a real, viewable artifact. opencode
    // finishing cleanly and replying with text is NOT the same thing: a reply alone (e.g. "I
    // won't build a screen for that — X is a data record, not a page") must not be reported as a
    // successful artifact, or the caller (apps/artifacts-viewer's /api/chat) persists this as
    // the session's "current artifact" and the frontend shows it as built, when artifactsRoot
    // actually only has a manifest.json in it and every later load 404s.
    if (!existsSync(join(artifactDir, INDEX_FILE))) {
      if (isNew) rmSync(artifactDir, { recursive: true, force: true });
      throw new ArtifactGenerationError(
        `opencode finished without producing ${INDEX_FILE} for this artifact. Its reply was: ${result.reply}`,
      );
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
      messages: [...request.messages, { role: 'assistant', content: result.reply }],
    };
  }
}
