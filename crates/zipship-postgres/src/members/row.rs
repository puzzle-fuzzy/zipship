use sqlx::FromRow;
use std::str::FromStr;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_domain::MemberRole;
use zipship_members::{Member, MembersRepositoryError};

pub(super) fn parse_role(value: &str) -> Result<MemberRole, MembersRepositoryError> {
    MemberRole::from_str(value).map_err(|_| corrupt_record("memberships.role"))
}

#[derive(Debug, FromRow)]
pub(super) struct MemberRow {
    user_id: Uuid,
    email: String,
    display_name: String,
    role: String,
    joined_at: OffsetDateTime,
}

impl TryFrom<MemberRow> for Member {
    type Error = MembersRepositoryError;

    fn try_from(row: MemberRow) -> Result<Self, Self::Error> {
        Ok(Self {
            user_id: row.user_id,
            email: row.email,
            display_name: row.display_name,
            role: parse_role(&row.role)?,
            joined_at: row.joined_at,
        })
    }
}

#[derive(Debug, Error)]
#[error("database contains an invalid members value in {field}")]
struct CorruptMemberRecord {
    field: &'static str,
}

fn corrupt_record(field: &'static str) -> MembersRepositoryError {
    MembersRepositoryError::unavailable(CorruptMemberRecord { field })
}
