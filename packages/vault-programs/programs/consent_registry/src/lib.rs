use anchor_lang::prelude::*;

declare_id!("FJTDfUACnh1GPVcp8KpSR6uEDzcW8AyL7KU7zrAJ3rcx");

#[program]
pub mod consent_registry {
    use super::*;

    /// Record a new consent from the patient.
    pub fn record_consent(
        ctx: Context<RecordConsent>,
        consent_type: ConsentType,
        scope: String,
        granted_to: Option<Pubkey>,
        duration_seconds: Option<i64>,
        method: ConsentMethod,
        nonce: u64,
    ) -> Result<()> {
        require!(scope.len() <= 512, ConsentError::ScopeTooLong);

        let now = Clock::get()?.unix_timestamp;
        let consent = &mut ctx.accounts.consent;
        consent.patient = ctx.accounts.patient.key();
        consent.consent_type = consent_type;
        consent.scope = scope;
        consent.granted_to = granted_to;
        consent.valid_from = now;
        consent.valid_until = duration_seconds.map(|d| now + d);
        consent.revoked_at = None;
        consent.witness = ctx.accounts.witness.as_ref().map(|w| w.key());
        consent.method = method;
        consent.nonce = nonce;
        consent.bump = ctx.bumps.consent;

        msg!(
            "Consent recorded: patient={}, type={:?}, method={:?}",
            ctx.accounts.patient.key(),
            consent.consent_type,
            consent.method
        );
        Ok(())
    }

    /// Patient revokes a consent.
    pub fn revoke_consent(ctx: Context<RevokeConsent>) -> Result<()> {
        let consent = &mut ctx.accounts.consent;
        require!(consent.revoked_at.is_none(), ConsentError::AlreadyRevoked);

        consent.revoked_at = Some(Clock::get()?.unix_timestamp);

        msg!(
            "Consent revoked: patient={}, type={:?}",
            ctx.accounts.patient.key(),
            consent.consent_type
        );
        Ok(())
    }

    /// Check if a consent is currently valid (view function).
    pub fn verify_consent(ctx: Context<VerifyConsent>) -> Result<bool> {
        let consent = &ctx.accounts.consent;
        let now = Clock::get()?.unix_timestamp;

        let is_valid = consent.revoked_at.is_none()
            && now >= consent.valid_from
            && consent
                .valid_until
                .map(|until| now <= until)
                .unwrap_or(true);

        msg!("Consent verification: valid={}", is_valid);
        Ok(is_valid)
    }
}

// === Accounts ===

#[derive(Accounts)]
#[instruction(consent_type: ConsentType, scope: String, granted_to: Option<Pubkey>, duration_seconds: Option<i64>, method: ConsentMethod, nonce: u64)]
pub struct RecordConsent<'info> {
    #[account(mut)]
    pub patient: Signer<'info>,

    /// Optional witness (nurse/staff for verbal consent)
    pub witness: Option<Signer<'info>>,

    #[account(
        init,
        payer = patient,
        space = ConsentRecord::SPACE,
        seeds = [
            b"consent",
            patient.key().as_ref(),
            &[consent_type as u8],
            &nonce.to_le_bytes(),
        ],
        bump
    )]
    pub consent: Account<'info, ConsentRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeConsent<'info> {
    pub patient: Signer<'info>,

    #[account(
        mut,
        constraint = consent.patient == patient.key() @ ConsentError::Unauthorized
    )]
    pub consent: Account<'info, ConsentRecord>,
}

#[derive(Accounts)]
pub struct VerifyConsent<'info> {
    pub consent: Account<'info, ConsentRecord>,
}

// === State ===

#[account]
pub struct ConsentRecord {
    pub patient: Pubkey,
    pub consent_type: ConsentType,
    pub scope: String,
    pub granted_to: Option<Pubkey>,
    pub valid_from: i64,
    pub valid_until: Option<i64>,
    pub revoked_at: Option<i64>,
    pub witness: Option<Pubkey>,
    pub method: ConsentMethod,
    pub nonce: u64,
    pub bump: u8,
}

impl ConsentRecord {
    pub const SPACE: usize = 8 + 32 + 1 + (4 + 512) + (1 + 32) + 8 + (1 + 8) + (1 + 8)
        + (1 + 32) + 1 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ConsentType {
    Treatment,
    Recording,
    Research,
    DataSharing,
    Emergency,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ConsentMethod {
    Written,
    Verbal,
    Digital,
    Auto,
}

// === Errors ===

#[error_code]
pub enum ConsentError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Scope string too long (max 512 chars)")]
    ScopeTooLong,
    #[msg("Consent already revoked")]
    AlreadyRevoked,
}
