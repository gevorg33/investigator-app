// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pinRole, pinWorkspace, scopeHeaders } from './workspace';

describe('the pinned workspace, on the server', () => {
  it('is never pinned, nor is a role: the module is shared by every request there', () => {
    pinWorkspace('ws-someone-else');
    pinRole('CUSTOMER');
    expect(scopeHeaders()).toEqual({});
  });
});
