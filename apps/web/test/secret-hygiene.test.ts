// HU-ASMS: Phase 11 Secret Hygiene & Client Bundle Protection Tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Phase 11 — Secret Hygiene & Client Protection Tests', () => {

  const forbiddenSecrets = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_WEBHOOK_SECRET',
  ];

  function getSourceFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...getSourceFiles(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        results.push(fullPath);
      }
    }

    return results;
  }

  it('should guarantee that no client components or browser files reference backend secret keys', () => {
    const webSrcDir = fs.existsSync(path.resolve(process.cwd(), 'src'))
      ? path.resolve(process.cwd(), 'src')
      : path.resolve(process.cwd(), 'apps/web/src');
    const sourceFiles = getSourceFiles(webSrcDir);

    assert.ok(sourceFiles.length > 5, 'Should have scanned multiple web source files');

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');

      // Check if file is client component or browser client
      const isClientComponent = content.includes("'use client'") || content.includes('"use client"');
      const isBrowserClient = filePath.endsWith('client.ts') || filePath.includes('components');

      if (isClientComponent || isBrowserClient) {
        for (const secret of forbiddenSecrets) {
          const hasSecret = content.includes(secret);
          assert.equal(
            hasSecret,
            false,
            `Security Violation: Secret "${secret}" found in client-side file: ${filePath}`
          );
        }
      }
    }
  });

  it('should verify that browser client strictly uses NEXT_PUBLIC_SUPABASE variables', () => {
    const clientPath = fs.existsSync(path.resolve(process.cwd(), 'src/lib/supabase/client.ts'))
      ? path.resolve(process.cwd(), 'src/lib/supabase/client.ts')
      : path.resolve(process.cwd(), 'apps/web/src/lib/supabase/client.ts');
    const content = fs.readFileSync(clientPath, 'utf-8');

    assert.ok(content.includes('process.env.NEXT_PUBLIC_SUPABASE_URL'));
    assert.ok(content.includes('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY'));
    assert.equal(content.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  });
});
