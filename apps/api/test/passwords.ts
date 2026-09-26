import { PasswordService } from '../src/modules/auth/password.service';

/**
 * A `PasswordService` as the running application has it: initialised, its decoy hash made
 * (T-129). A spec that constructs one directly skips `onModuleInit`, and its first unknown-address
 * login would then throw rather than run the decoy.
 */
export async function readyPasswords(): Promise<PasswordService> {
  const passwords = new PasswordService();
  await passwords.onModuleInit();
  return passwords;
}
