use sqlx::FromRow;
use std::str::FromStr;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;
use zipship_auth::NormalizedEmail;
use zipship_domain::MemberRole;
use zipship_invitations::{Invitation, InvitationState, InvitationsRepositoryError};

#[derive(Debug, FromRow)]
pub(super) struct InvitationRow {
    id: Uuid,
    organization_id: Uuid,
    email: String,
    role: String,
    state: String,
    invited_by: Option<Uuid>,
    accepted_by: Option<Uuid>,
    created_at: OffsetDateTime,
    expires_at: OffsetDateTime,
    resolved_at: Option<OffsetDateTime>,
}

impl TryFrom<InvitationRow> for Invitation {
    type Error = InvitationsRepositoryError;

    fn try_from(row: InvitationRow) -> Result<Self, Self::Error> {
        NormalizedEmail::parse(&row.email).map_err(|_| corrupt_record("invitations.email"))?;
        Ok(Self {
            id: row.id,
            organization_id: row.organization_id,
            email: row.email,
            role: parse_role(&row.role)?,
            state: parse_state(&row.state)?,
            invited_by: row.invited_by,
            accepted_by: row.accepted_by,
            created_at: row.created_at,
            expires_at: row.expires_at,
            resolved_at: row.resolved_at,
        })
    }
}

pub(super) fn parse_role(value: &str) -> Result<MemberRole, InvitationsRepositoryError> {
    MemberRole::from_str(value).map_err(|_| corrupt_record("invitations.role"))
}

pub(super) fn parse_state(value: &str) -> Result<InvitationState, InvitationsRepositoryError> {
    InvitationState::from_str(value).map_err(|_| corrupt_record("invitations.state"))
}

#[derive(Debug, Error)]
#[error("database contains an invalid invitations value in {field}")]
struct CorruptInvitationRecord {
    field: &'static str,
}

fn corrupt_record(field: &'static str) -> InvitationsRepositoryError {
    InvitationsRepositoryError::unavailable(CorruptInvitationRecord { field })
}
