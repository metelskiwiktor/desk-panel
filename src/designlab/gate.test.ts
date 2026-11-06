import { describe, expect, it } from 'vitest';
import { designLabName } from './gate';

describe('DesignLab gate', () => {
  it('ignores ?designlab outside a preview started with it (service, just dev, production build)', () => {
    expect(designLabName(false, '?designlab=demo')).toBeNull();
    expect(designLabName(__DESIGNLAB__, '?designlab=demo')).toBeNull(); // the build config default
  });
  it('names the mockup in a preview, and shows the normal panel without the parameter', () => {
    expect(designLabName(true, '?designlab=demo')).toBe('demo');
    expect(designLabName(true, '?ambient=night')).toBeNull();
  });
});
