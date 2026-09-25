import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ArtifactCatalogService } from './artifact-catalog.service.js';

function makeArtifact(root: string, slug: string, opts: { indexHtml?: boolean; title?: string } = {}): void {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ roles: ['OWNER'], title: opts.title }));
  if (opts.indexHtml !== false) {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html></html>');
  }
}

describe('ArtifactCatalogService', () => {
  let root: string;
  let service: ArtifactCatalogService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'artifact-catalog-test-'));
    service = new ArtifactCatalogService(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('list', () => {
    it('includes a complete artifact (manifest.json + index.html)', async () => {
      makeArtifact(root, 'good-page', { title: 'Good Page' });
      const entries = await service.list();
      expect(entries).toEqual([{ slug: 'good-page', title: 'Good Page', roles: ['OWNER'] }]);
    });

    // Regression: artifact-agent-service used to write manifest.json even when opencode produced
    // no real content — the resulting directory showed up as a clickable sidebar entry that 404'd
    // the moment anyone opened it. chat-service.ts no longer does that, but list() still guards
    // against any manifest-only directory that ends up on disk some other way.
    it('excludes a manifest-only directory with no index.html', async () => {
      makeArtifact(root, 'broken-page', { indexHtml: false });
      const entries = await service.list();
      expect(entries).toEqual([]);
    });

    it('excludes the broken entry while still listing a real one alongside it', async () => {
      makeArtifact(root, 'broken-page', { indexHtml: false });
      makeArtifact(root, 'good-page', { title: 'Good Page' });
      const entries = await service.list();
      expect(entries.map((e) => e.slug)).toEqual(['good-page']);
    });
  });

  describe('remove', () => {
    it('can still delete a broken (manifest-only) artifact, even though list() hides it', async () => {
      makeArtifact(root, 'broken-page', { indexHtml: false });
      expect(await service.list()).toEqual([]);

      await service.remove('broken-page');

      expect(existsSync(join(root, 'broken-page'))).toBe(false);
    });
  });

  describe('rename', () => {
    it('can still rename a broken (manifest-only) artifact', async () => {
      makeArtifact(root, 'broken-page', { indexHtml: false, title: 'Old Title' });

      await service.rename('broken-page', 'New Title');

      const manifest = JSON.parse(await readFile(join(root, 'broken-page', 'manifest.json'), 'utf-8'));
      expect(manifest.title).toBe('New Title');
    });
  });
});
