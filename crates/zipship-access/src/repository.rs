use std::error::Error as StdError;

use async_trait::async_trait;
use thiserror::Error;
use uuid::Uuid;
use zipship_domain::ProjectSlug;

use crate::PreviewRelease;

#[derive(Debug, Error)]
pub enum PreviewRepositoryError {
    #[error("preview metadata is corrupt")]
    CorruptRecord,
    #[error("preview repository is unavailable")]
    Unavailable {
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
}

impl PreviewRepositoryError {
    pub fn unavailable(source: impl StdError + Send + Sync + 'static) -> Self {
        Self::Unavailable {
            source: Box::new(source),
        }
    }
}

#[async_trait]
pub trait PreviewRepository: Send + Sync + 'static {
    async fn find_ready_release(
        &self,
        project_slug: &ProjectSlug,
        release_id: Uuid,
    ) -> Result<Option<PreviewRelease>, PreviewRepositoryError>;

    async fn find_active_release(
        &self,
        project_slug: &ProjectSlug,
    ) -> Result<Option<PreviewRelease>, PreviewRepositoryError>;
}
