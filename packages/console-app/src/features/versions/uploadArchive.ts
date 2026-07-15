import JSZip from 'jszip';
import type { SelectedArtifact } from './uploadDialogModel';

export interface PreparedUpload {
  artifact: SelectedArtifact;
  archive: File;
}

export function prepareZipUpload(file: File): PreparedUpload {
  return {
    artifact: { mode: 'zip', name: file.name, size: file.size },
    archive: file,
  };
}

export function describeFolderUpload(files: File[]): SelectedArtifact {
  const firstFile = files[0];
  if (!firstFile) {
    throw new Error('A folder upload requires at least one file.');
  }

  return {
    mode: 'folder',
    name: firstFile.webkitRelativePath.split('/')[0] || 'upload',
    size: files.reduce((total, file) => total + file.size, 0),
  };
}

export function describeSingleFileUpload(file: File): SelectedArtifact {
  return { mode: 'file', name: file.name, size: file.size };
}

export async function prepareFolderUpload(files: File[]): Promise<PreparedUpload> {
  const artifact = describeFolderUpload(files);
  const zip = new JSZip();

  for (const file of files) {
    zip.file(file.webkitRelativePath || file.name, await file.arrayBuffer());
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    artifact,
    archive: new File([blob], `${artifact.name}.zip`, { type: 'application/zip' }),
  };
}

export async function prepareSingleFileUpload(file: File): Promise<PreparedUpload> {
  const artifact = describeSingleFileUpload(file);
  const zip = new JSZip();
  zip.file(file.name, await file.arrayBuffer());
  const blob = await zip.generateAsync({ type: 'blob' });

  return {
    artifact,
    archive: new File([blob], 'upload.zip', { type: 'application/zip' }),
  };
}
