import { Test } from '@nestjs/testing';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readyPasswords } from '../../../test/passwords';
import { PasswordService } from './password.service';

// argon2 as it is, with every call counted — so a test can say how much work a call did without
// a stopwatch, whatever the service calls it through.
vi.mock('@node-rs/argon2', async (importOriginal) => {
  const real = await importOriginal<typeof import('@node-rs/argon2')>();
  return { ...real, hash: vi.fn(real.hash), verify: vi.fn(real.verify) };
});

describe('PasswordService', () => {
  let svc: PasswordService;

  beforeAll(async () => {
    svc = await readyPasswords();
  });

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
   * **first** call, which also computed the decoy hash — so the ratio sat at ~2x before any
   * noise, and reached 4.55x under load (5.58x once, in T-010). It then warmed the decoy up and
   * compared medians of interleaved pairs, so load drifts both sides equally. Since T-129 the
   * first call is not special — the decoy is made at startup — so there is no warm-up to do.
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

  /**
   * T-129. The decoy used to be made on the first unknown-address login in each process, which
   * then cost a hash and a verification — about twice a real one, and a tell. Counted, not timed:
   * the first call makes one verification and no hash at all.
   */
  it('costs one verification on its very first call, because the decoy was made at startup', async () => {
    // A fresh copy of the module, as in a process that has just started: nothing made yet.
    vi.resetModules();
    const argon2 = await import('@node-rs/argon2');
    const { PasswordService: Fresh } = await import('./password.service');
    const fresh = new Fresh();
    await fresh.onModuleInit();
    vi.mocked(argon2.hash).mockClear();
    vi.mocked(argon2.verify).mockClear();

    await fresh.verifyDecoy('first attempt');
    expect(argon2.hash).not.toHaveBeenCalled();
    expect(argon2.verify).toHaveBeenCalledTimes(1);
  });

  it('refuses to run the decoy if it was never initialised, rather than making one late', async () => {
    const verifies = vi.spyOn(PasswordService.prototype, 'verify');
    try {
      await expect(new PasswordService().verifyDecoy('x')).rejects.toThrow(/before onModuleInit/);
      expect(verifies).not.toHaveBeenCalled();
    } finally {
      verifies.mockRestore();
    }
  });

  it('is initialised by the application before it serves anything', async () => {
    const mod = await Test.createTestingModule({ providers: [PasswordService] }).compile();
    const app = mod.createNestApplication();
    await app.init();
    const verifies = vi.spyOn(app.get(PasswordService), 'verify');
    await app.get(PasswordService).verifyDecoy('x');
    expect(verifies).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('keeps an application that cannot make the decoy from starting', async () => {
    const failing = vi
      .spyOn(PasswordService.prototype, 'hash')
      .mockRejectedValue(new Error('argon2 unavailable'));
    try {
      const mod = await Test.createTestingModule({ providers: [PasswordService] }).compile();
      await expect(mod.createNestApplication().init()).rejects.toThrow('argon2 unavailable');
    } finally {
      failing.mockRestore();
    }
  });

  it('spends comparable time on a decoy, closing the timing oracle', async () => {
    const h = await svc.hash('real');

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
