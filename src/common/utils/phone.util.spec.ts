import {
  buildPhoneLookupCandidates,
  normalizeStoredPhone,
} from './phone.util';

describe('phone.util', () => {
  it('normalizes stored phones while preserving a leading plus', () => {
    expect(normalizeStoredPhone(' +237 699-12-34-56 ')).toBe('+237699123456');
    expect(normalizeStoredPhone('699 12 34 56')).toBe('699123456');
  });

  it('builds lookup candidates for Cameroon local and international formats', () => {
    expect(buildPhoneLookupCandidates('699 12 34 56')).toEqual(
      expect.arrayContaining(['699123456', '237699123456', '+237699123456']),
    );
    expect(buildPhoneLookupCandidates('+237 699 12 34 56')).toEqual(
      expect.arrayContaining(['699123456', '237699123456', '+237699123456']),
    );
  });
});
