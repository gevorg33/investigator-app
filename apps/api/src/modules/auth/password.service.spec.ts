import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('produces an argon2id hash, not bcrypt or plain', async () => {
    const h = await svc.hash('correct horse battery staple');
    expect(h).toMatch(/^\$argon2id\$/);
  });

  it('never returns the plaintext anywhere in the hash', async () => {
    const secret = 'a-very-distinctive-password-value';
    const h = await svc.hash(secret);
    expect(h).not.toContain(secret);
  });

  it('salts — the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([svc.hash('same'), svc.hash('same')]);
    expect(a).not.toBe(b);
  });

  it('verifies a correct password', async () => {
    const h = await svc.hash('right');
    await expect(svc.verify(h, 'right')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const h = await svc.hash('right');
    await expect(svc.verify(h, 'wrong')).resolves.toBe(false);
  });

  it('fails closed on a malformed stored hash rather than throwing', async () => {
    await expect(svc.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('spends comparable time on a decoy, closing the timing oracle', async () => {
    const h = await svc.hash('real');
    const t0 = performance.now();
    await svc.verify(h, 'wrong');
    const real = performance.now() - t0;

    const t1 = performance.now();
    await svc.verifyDecoy('wrong');
    const decoy = performance.now() - t1;

    // Same order of magnitude. A no-op decoy would be ~1000x faster and the
    // difference would tell an attacker which addresses are registered.
    const ratio = Math.max(real, decoy) / Math.max(1, Math.min(real, decoy));
    expect(ratio).toBeLessThan(5);
  });
});
