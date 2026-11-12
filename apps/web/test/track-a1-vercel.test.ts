// HU-ASMS: Phase 14 Track A1 — Vercel Monorepo Configuration Regression Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webRoot, '../..');

describe('Phase 14 Track A1 — Vercel & Next.js Monorepo Configuration', () => {
  it('should not keep the conflicting BOM-encoded root vercel.json', () => {
    const rootVercelPath = path.join(repoRoot, 'vercel.json');
    assert.equal(
      fs.existsSync(rootVercelPath),
      false,
      'Root vercel.json must remain removed so Vercel uses apps/web as Root Directory'
    );
  });

  it('should ship a valid UTF-8 BOM-free apps/web/vercel.json for the monorepo web app', () => {
    const webVercelPath = path.join(webRoot, 'vercel.json');
    assert.equal(fs.existsSync(webVercelPath), true, 'apps/web/vercel.json must exist');

    const rawBytes = fs.readFileSync(webVercelPath);
    assert.ok(rawBytes.length > 2, 'apps/web/vercel.json must not be empty');
    const hasUtf8Bom =
      rawBytes[0] === 0xef && rawBytes[1] === 0xbb && rawBytes[2] === 0xbf;
    assert.equal(hasUtf8Bom, false, 'apps/web/vercel.json must not contain a UTF-8 BOM');

    const parsed = JSON.parse(rawBytes.toString('utf8')) as {
      framework?: string;
      installCommand?: string;
      buildCommand?: string;
      outputDirectory?: string;
    };

    assert.equal(parsed.framework, 'nextjs');
    assert.equal(parsed.installCommand, 'cd ../.. && npm install');
    assert.equal(parsed.buildCommand, 'cd ../.. && npm run build');
    assert.equal(parsed.outputDirectory, undefined);
  });

  it('should configure outputFileTracingRoot to the monorepo root in apps/web/next.config.mjs', () => {
    const nextConfigPath = path.join(webRoot, 'next.config.mjs');
    assert.equal(fs.existsSync(nextConfigPath), true, 'apps/web/next.config.mjs must exist');

    const configSource = fs.readFileSync(nextConfigPath, 'utf8');
    assert.match(configSource, /outputFileTracingRoot:\s*path\.resolve\(__dirname,\s*'\.\.\/\.\.'\)/);
    assert.match(configSource, /transpilePackages:\s*\[/);
    assert.match(configSource, /'@hu-asms\/validation'/);
    assert.match(configSource, /'@hu-asms\/types'/);
  });
});
