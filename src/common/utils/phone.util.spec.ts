import {
  buildPhoneLookupCandidates,
  detectCameroonMobileOperator,
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

  it.each([
    ['655123456', 'ORANGE'],
    ['659123456', 'ORANGE'],
    ['686123456', 'ORANGE'],
    ['689123456', 'ORANGE'],
    ['690123456', 'ORANGE'],
    ['699123456', 'ORANGE'],
    ['650123456', 'MTN'],
    ['654123456', 'MTN'],
    ['670123456', 'MTN'],
    ['679123456', 'MTN'],
    ['680123456', 'MTN'],
    ['685123456', 'MTN'],
    ['237677123456', 'MTN'],
    ['+237 691 22 44 72', 'ORANGE'],
    ['00237650123456', 'MTN'],
  ])('detects the mobile-money operator of %s as %s', (phone, operator) => {
    expect(detectCameroonMobileOperator(phone)).toBe(operator);
  });

  it.each(['620123456', '660123456', '612345678', '67712345', '', 'abc'])(
    'returns null for an unsupported or invalid number %p',
    (phone) => {
      expect(detectCameroonMobileOperator(phone)).toBeNull();
    },
  );
});
