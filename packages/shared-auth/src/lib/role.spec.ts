import { isRole } from './role.js';

describe('isRole', () => {
  it('accepts known roles', () => {
    expect(isRole('OWNER')).toBe(true);
    expect(isRole('STOREKEEPER')).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isRole('superuser')).toBe(false);
    expect(isRole('')).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(42)).toBe(false);
  });
});
