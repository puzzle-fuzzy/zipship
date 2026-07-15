use super::*;

#[derive(Default)]
pub(super) struct RecoveryState {
    pub(super) created: Vec<NewPasswordReset>,
    pub(super) consumed: Vec<ConsumePasswordReset>,
}

#[derive(Default)]
pub(super) struct TestRecoveryRepository {
    pub(super) state: Mutex<RecoveryState>,
}
#[async_trait]
impl PasswordRecoveryRepository for TestRecoveryRepository {
    async fn create_password_reset(
        &self,
        reset: NewPasswordReset,
    ) -> Result<PasswordResetRequestDisposition, PasswordRecoveryRepositoryError> {
        self.state.lock().unwrap().created.push(reset);
        Ok(PasswordResetRequestDisposition::Created)
    }

    async fn consume_password_reset(
        &self,
        reset: ConsumePasswordReset,
    ) -> Result<(), PasswordRecoveryRepositoryError> {
        self.state.lock().unwrap().consumed.push(reset);
        Ok(())
    }
}
