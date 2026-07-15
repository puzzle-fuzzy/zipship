use secrecy::SecretString;
use zipship_mail::{PasswordResetMail, PasswordResetMailer, SmtpPasswordResetMailer};

#[tokio::test]
#[ignore = "requires a local SMTP capture server"]
async fn delivers_password_reset_mail_over_smtp() {
    let smtp_url = std::env::var("ZIPSHIP_TEST_SMTP_URL")
        .expect("ZIPSHIP_TEST_SMTP_URL must point to an isolated SMTP capture server");
    let mailer = SmtpPasswordResetMailer::new(
        &SecretString::from(smtp_url),
        "ZipShip Test <security@example.test>",
    )
    .unwrap();

    mailer
        .send(&PasswordResetMail {
            recipient: "recipient@example.test".to_owned(),
            reset_url: SecretString::from(
                "https://console.example.test/reset-password#token=test-only-token",
            ),
        })
        .await
        .unwrap();
}
