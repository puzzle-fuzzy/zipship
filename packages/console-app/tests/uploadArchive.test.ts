import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  prepareFolderUpload,
  prepareSingleFileUpload,
  prepareZipUpload,
} from '../src/features/versions/uploadArchive';

function fileWithRelativePath(name: string, content: string, relativePath: string) {
  const file = new File([content], name, { type: 'text/plain' });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

describe('upload archive preparation', () => {
  it('keeps an existing zip unchanged', () => {
    const file = new File(['zip'], 'site.zip', { type: 'application/zip' });

    expect(prepareZipUpload(file)).toEqual({
      artifact: { mode: 'zip', name: 'site.zip', size: file.size },
      archive: file,
    });
  });

  it('packages a selected folder while preserving relative paths', async () => {
    const files = [
      fileWithRelativePath('index.html', '<h1>Site</h1>', 'site/index.html'),
      fileWithRelativePath('app.css', 'body {}', 'site/assets/app.css'),
    ];

    const prepared = await prepareFolderUpload(files);
    const archive = await JSZip.loadAsync(await prepared.archive.arrayBuffer());

    expect(prepared.artifact).toEqual({
      mode: 'folder',
      name: 'site',
      size: files[0].size + files[1].size,
    });
    expect(prepared.archive.name).toBe('site.zip');
    expect(Object.keys(archive.files)).toEqual([
      'site/',
      'site/index.html',
      'site/assets/',
      'site/assets/app.css',
    ]);
  });

  it('wraps one HTML file in an upload archive', async () => {
    const file = new File(['<h1>Site</h1>'], 'index.html', { type: 'text/html' });

    const prepared = await prepareSingleFileUpload(file);
    const archive = await JSZip.loadAsync(await prepared.archive.arrayBuffer());

    expect(prepared.artifact).toEqual({
      mode: 'file',
      name: 'index.html',
      size: file.size,
    });
    expect(prepared.archive.name).toBe('upload.zip');
    expect(await archive.file('index.html')?.async('string')).toBe('<h1>Site</h1>');
  });

  it('rejects an empty folder selection', async () => {
    await expect(prepareFolderUpload([])).rejects.toThrow(
      'A folder upload requires at least one file.',
    );
  });
});
