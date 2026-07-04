export interface StoragePaths {
  uploadsRoot: string;
  tempRoot: string;
  sitesRoot: string;
}

export function createStoragePaths(root: string): StoragePaths {
  return {
    uploadsRoot: `${root}/uploads`,
    tempRoot: `${root}/temp`,
    sitesRoot: `${root}/sites`,
  };
}
