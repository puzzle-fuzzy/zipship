import { describe, expect, it, mock } from 'bun:test';
import { createDesktopRuntime } from '../src';

describe('desktop runtime', () => {
  it('delegates safe external URLs to the native opener', async () => {
    const openUrl = mock(async (_url: string) => {});
    const runtime = createDesktopRuntime(openUrl);

    await runtime.openExternal('https://sites.example.test/demo/');

    expect(openUrl).toHaveBeenCalledWith('https://sites.example.test/demo/');
  });

  it('rejects non-http protocols and credentialed URLs before invoking native code', async () => {
    const openUrl = mock(async (_url: string) => {});
    const runtime = createDesktopRuntime(openUrl);

    await expect(runtime.openExternal('file:///etc/passwd')).rejects.toThrow(
      'External URL must use HTTP or HTTPS without credentials',
    );
    await expect(
      runtime.openExternal('https://user:secret@example.test/'),
    ).rejects.toThrow('External URL must use HTTP or HTTPS without credentials');
    expect(openUrl).not.toHaveBeenCalled();
  });
});
