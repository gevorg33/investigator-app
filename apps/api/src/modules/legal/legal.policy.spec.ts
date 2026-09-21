import { describe, expect, it } from 'vitest';
import { REQUIRED_AT_REGISTRATION, requiredForRole } from './legal.policy';

/**
 * Which documents bind whom (T-022). A compliance decision written down as data — changing this
 * is changing a legal position, so it is stated in one place and asserted here.
 */
describe('what each role must accept', () => {
  it('asks everybody for the privacy policy and the terms of service at registration', () => {
    expect([...REQUIRED_AT_REGISTRATION]).toEqual(['PRIVACY_POLICY', 'TERMS_OF_SERVICE']);
  });

  it('asks an investigator for the agreement and the lawful-use policy', () => {
    expect([...requiredForRole('INVESTIGATOR')]).toEqual([
      'INVESTIGATOR_AGREEMENT',
      'LAWFUL_USE_POLICY',
    ]);
  });

  it('asks a customer for the terms and conditions', () => {
    expect([...requiredForRole('CUSTOMER')]).toEqual(['TERMS_AND_CONDITIONS']);
  });

  it('asks a staff role for nothing: it is granted by staff, never self-activated', () => {
    expect([...requiredForRole('STAFF')]).toEqual([]);
  });
});
