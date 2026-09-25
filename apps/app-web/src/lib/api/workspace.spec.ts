// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pinWorkspace, workspaceHeader } from './workspace';

describe('the pinned workspace, on the server', () => {
  it('is never pinned: the module is shared by every request there', () => {
    pinWorkspace('ws-someone-else');
    expect(workspaceHeader()).toEqual({});
  });
});
