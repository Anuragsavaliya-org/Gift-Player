import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src';

describe('version', () => {
  it('VERSION equals the version in package.json (bump both together)', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it('the changelog has an entry for the current version', () => {
    const log = readFileSync(join(__dirname, '../CHANGELOG.md'), 'utf8');
    expect(log).toMatch(new RegExp(`^## \\[${VERSION.replace(/\./g, '\\.')}\\]`, 'm'));
  });
});
