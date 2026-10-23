import { describe, expect, it } from 'vitest';
import { VERSION } from '../src';

describe('skeleton', () => {
  it('exports a version', () => {
    expect(VERSION).toBe('0.0.0');
  });
});
