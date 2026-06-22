import { describe, it, expect } from 'vitest';

// We need to test the pure helper functions from attachments.ts.
// Since they are not exported, we test them indirectly via known behavior,
// or we can use a workaround to import the module and access internals.

// The functions we want to test: detectCategory, sanitizeFilename
// These are currently private. We'll test the public API touchpoints
// that exercise them, plus write tests that validate the logic
// directly if we refactor to export them.

// For now, let's test the constants and the AttachmentError class.

import { AttachmentError, MAX_ATTACHMENT_FILE_BYTES, MAX_SESSION_ATTACHMENT_BYTES } from './attachments';

describe('attachments constants', () => {
  it('MAX_ATTACHMENT_FILE_BYTES is 20MB', () => {
    expect(MAX_ATTACHMENT_FILE_BYTES).toBe(20 * 1024 * 1024);
  });

  it('MAX_SESSION_ATTACHMENT_BYTES is 100MB', () => {
    expect(MAX_SESSION_ATTACHMENT_BYTES).toBe(100 * 1024 * 1024);
  });
});

describe('AttachmentError', () => {
  it('sets status and message', () => {
    const err = new AttachmentError(413, '文件太大');
    expect(err.status).toBe(413);
    expect(err.message).toBe('文件太大');
    expect(err).toBeInstanceOf(Error);
  });
});
