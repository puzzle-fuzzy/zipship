use crate::model::StorageError;
use std::path::{Component, Path};

pub(crate) fn regular_path_components(
    asset_path: &str,
) -> Result<Vec<&std::ffi::OsStr>, StorageError> {
    if asset_path.is_empty() || asset_path.contains(['\\', '\0']) {
        return Err(StorageError::InvalidArtifactPath);
    }
    let components = Path::new(asset_path)
        .components()
        .map(|component| match component {
            Component::Normal(value) => Ok(value),
            _ => Err(StorageError::InvalidArtifactPath),
        })
        .collect::<Result<Vec<_>, _>>()?;
    if components.is_empty() {
        return Err(StorageError::InvalidArtifactPath);
    }
    Ok(components)
}

#[cfg(unix)]
pub(crate) async fn sync_directory_if_supported(path: &Path) -> Result<(), std::io::Error> {
    tokio::fs::File::open(path).await?.sync_all().await
}

#[cfg(not(unix))]
pub(crate) async fn sync_directory_if_supported(_path: &Path) -> Result<(), std::io::Error> {
    Ok(())
}
