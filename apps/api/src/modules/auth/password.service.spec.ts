import { describe, expect, it, vi } from 'vitest';
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

  /**
   * The decoy exists so that a login for an unregistered address costs the same as a wrong
   * password for a registered one. Two proofs, because each alone has a gap:
   *
   * - **Structure** — the decoy is verified against a hash with the same algorithm and the same
   *   cost parameters as a real one. No clock involved, so it cannot flake, and it catches a
   *   decoy made merely cheaper, which a loose timing bound might wave through.
   * - **Time** — the two paths actually take comparable time. The bound is unchanged (< 5x); a
   *   no-op decoy is ~1000x faster.
   *
   * T-069: the timing proof used to take one sample of each, and the decoy's sample was its
   * **first** call, which also computes the decoy hash — so the ratio sat at ~2x before any
   * noise, and reached 4.55x under load (5.58x once, in T-010). It now warms the decoy up, then
   * compares medians of interleaved pairs, so load drifts both sides equally.
   */
  it('verifies the decoy against a hash with the same cost as a real one', async () => {
    const real = await svc.hash('real');
    const spy = vi.spyOn(svc, 'verify');
    await svc.verifyDecoy('anything');
    const decoyHash = spy.mock.calls[0]?.[0];
    spy.mockRestore();

    // $argon2id$v=19$m=19456,t=2,p=1$salt$hash — everything before the salt is the cost.
    const cost = (h: string | undefined) => h?.split('$').slice(1, 4).join('$');
    expect(cost(decoyHash)).toBe(cost(real));
    expect(cost(real)).toMatch(/^argon2id\$v=19\$m=\d+,t=\d+,p=\d+$/);
  });

  it('spends comparable time on a decoy, closing the timing oracle', async () => {
    const h = await svc.hash('real');
    await svc.verifyDecoy('warm-up'); // the first call also computes the decoy hash

    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const timed = async (fn: () => Promise<unknown>) => {
      const t0 = performance.now();
      await fn();
      return performance.now() - t0;
    };

    const real: number[] = [];
    const decoy: number[] = [];
    for (let i = 0; i < 7; i++) {
      real.push(await timed(() => svc.verify(h, 'wrong')));
      decoy.push(await timed(() => svc.verifyDecoy('wrong')));
    }

    // Same order of magnitude. A no-op decoy would be ~1000x faster and the
    // difference would tell an attacker which addresses are registered.
    const [r, d] = [median(real), median(decoy)];
    const ratio = Math.max(r, d) / Math.max(1, Math.min(r, d));
    expect(ratio).toBeLessThan(5);
  });
});
