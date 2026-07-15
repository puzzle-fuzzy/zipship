use super::*;

pub(super) struct TestMembersRepository;

#[derive(Default)]
pub(super) struct TestInvitationsRepository {
    invitations: Mutex<Vec<(Invitation, TokenDigest)>>,
}
#[async_trait]
impl MembersRepository for TestMembersRepository {
    async fn list_members(
        &self,
        organization_id: Uuid,
        actor_id: Uuid,
    ) -> Result<Vec<Member>, MembersRepositoryError> {
        if organization_id != TEST_ORGANIZATION_ID {
            return Err(MembersRepositoryError::Forbidden);
        }
        Ok(vec![Member {
            user_id: actor_id,
            email: "owner@example.com".to_owned(),
            display_name: "Owner".to_owned(),
            role: MemberRole::Owner,
            joined_at: OffsetDateTime::UNIX_EPOCH,
        }])
    }

    async fn update_role(
        &self,
        update: UpdateMemberRole,
    ) -> Result<Member, MembersRepositoryError> {
        if update.organization_id != TEST_ORGANIZATION_ID {
            return Err(MembersRepositoryError::Forbidden);
        }
        if update.target_user_id == update.actor_id && update.role != MemberRole::Owner {
            return Err(MembersRepositoryError::LastOwner);
        }
        Ok(Member {
            user_id: update.target_user_id,
            email: "member@example.com".to_owned(),
            display_name: "Member".to_owned(),
            role: update.role,
            joined_at: OffsetDateTime::UNIX_EPOCH,
        })
    }

    async fn remove_member(&self, removal: RemoveMember) -> Result<(), MembersRepositoryError> {
        if removal.organization_id != TEST_ORGANIZATION_ID {
            return Err(MembersRepositoryError::Forbidden);
        }
        if removal.target_user_id == removal.actor_id {
            return Err(MembersRepositoryError::LastOwner);
        }
        Ok(())
    }
}

#[async_trait]
impl InvitationsRepository for TestInvitationsRepository {
    async fn create_invitation(
        &self,
        invitation: NewInvitation,
    ) -> Result<Invitation, InvitationsRepositoryError> {
        let stored = Invitation {
            id: invitation.id,
            organization_id: invitation.organization_id,
            email: invitation.email.as_str().to_owned(),
            role: invitation.role,
            state: InvitationState::Pending,
            invited_by: Some(invitation.invited_by),
            accepted_by: None,
            created_at: invitation.created_at,
            expires_at: invitation.expires_at,
            resolved_at: None,
        };
        self.invitations
            .lock()
            .unwrap()
            .push((stored.clone(), invitation.token_digest));
        Ok(stored)
    }

    async fn list_invitations(
        &self,
        request: ListInvitations,
    ) -> Result<Vec<Invitation>, InvitationsRepositoryError> {
        if request.organization_id != TEST_ORGANIZATION_ID {
            return Err(InvitationsRepositoryError::Forbidden);
        }
        Ok(self
            .invitations
            .lock()
            .unwrap()
            .iter()
            .map(|(invitation, _)| invitation)
            .filter(|invitation| {
                invitation.state == InvitationState::Pending && invitation.expires_at > request.now
            })
            .cloned()
            .collect())
    }

    async fn revoke_invitation(
        &self,
        request: RevokeInvitation,
    ) -> Result<(), InvitationsRepositoryError> {
        let mut invitations = self.invitations.lock().unwrap();
        let invitation = invitations
            .iter_mut()
            .map(|(invitation, _)| invitation)
            .find(|invitation| {
                invitation.organization_id == request.organization_id
                    && invitation.id == request.invitation_id
                    && invitation.state == InvitationState::Pending
            })
            .ok_or(InvitationsRepositoryError::NotFound)?;
        invitation.state = InvitationState::Revoked;
        invitation.resolved_at = Some(request.revoked_at);
        Ok(())
    }

    async fn accept_invitation(
        &self,
        request: AcceptInvitation,
    ) -> Result<AcceptedInvitation, InvitationsRepositoryError> {
        let mut invitations = self.invitations.lock().unwrap();
        let invitation = invitations
            .iter_mut()
            .find(|(_, digest)| *digest == request.token_digest)
            .map(|(invitation, _)| invitation)
            .ok_or(InvitationsRepositoryError::NotFound)?;
        if invitation.state == InvitationState::Accepted
            && invitation.accepted_by == Some(request.actor_id)
        {
            return Ok(AcceptedInvitation {
                invitation_id: invitation.id,
                organization_id: invitation.organization_id,
                user_id: request.actor_id,
                role: invitation.role,
                replayed: true,
            });
        }
        if invitation.state != InvitationState::Pending {
            return Err(InvitationsRepositoryError::NotFound);
        }
        if invitation.email != request.actor_email.as_str() {
            return Err(InvitationsRepositoryError::WrongRecipient);
        }
        invitation.state = InvitationState::Accepted;
        invitation.accepted_by = Some(request.actor_id);
        invitation.resolved_at = Some(request.accepted_at);
        Ok(AcceptedInvitation {
            invitation_id: invitation.id,
            organization_id: invitation.organization_id,
            user_id: request.actor_id,
            role: invitation.role,
            replayed: false,
        })
    }
}
