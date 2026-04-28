use anchor_lang::prelude::*;

declare_id!("CBsD1f6ex2us5X2Tm4DULEa8gLr4n6yw5hsSUmyyHHW2");

#[program]
pub mod access_grants {
    use super::*;

    /// Patient creates an access grant for a clinician.
    /// This is the NFT-based permission system — the doctor holds this grant
    /// to decrypt and read/write patient records.
    pub fn create_grant(
        ctx: Context<CreateGrant>,
        scope: AccessScope,
        re_encryption_key: [u8; 48],
        duration_seconds: i64,
        max_accesses: Option<u32>,
        grant_reason: String,
        nonce: u64,
    ) -> Result<()> {
        require!(grant_reason.len() <= 256, GrantError::ReasonTooLong);
        require!(duration_seconds > 0, GrantError::InvalidDuration);

        let now = Clock::get()?.unix_timestamp;
        let grant = &mut ctx.accounts.grant;
        grant.patient = ctx.accounts.patient.key();
        grant.grantee = ctx.accounts.grantee.key();
        grant.scope = scope;
        grant.re_encryption_key = re_encryption_key;
        grant.valid_from = now;
        grant.valid_until = now + duration_seconds;
        grant.max_accesses = max_accesses;
        grant.access_count = 0;
        grant.status = GrantStatus::Active;
        grant.grant_reason = grant_reason;
        grant.nonce = nonce;
        grant.bump = ctx.bumps.grant;

        msg!(
            "Access grant created: patient={}, grantee={}, expires={}",
            ctx.accounts.patient.key(),
            ctx.accounts.grantee.key(),
            grant.valid_until
        );
        Ok(())
    }

    /// Clinician uses the grant to access records.
    /// Increments counter, checks expiry and max access limits.
    pub fn use_grant(ctx: Context<UseGrant>) -> Result<()> {
        let grant = &mut ctx.accounts.grant;
        let now = Clock::get()?.unix_timestamp;

        require!(
            grant.status == GrantStatus::Active,
            GrantError::GrantNotActive
        );
        require!(now >= grant.valid_from, GrantError::GrantNotYetValid);
        require!(now <= grant.valid_until, GrantError::GrantExpired);

        if let Some(max) = grant.max_accesses {
            require!(grant.access_count < max, GrantError::MaxAccessesReached);
        }

        grant.access_count += 1;

        msg!(
            "Grant used: grantee={}, access_count={}, patient={}",
            ctx.accounts.grantee.key(),
            grant.access_count,
            grant.patient
        );
        Ok(())
    }

    /// Patient revokes an access grant immediately.
    pub fn revoke_grant(ctx: Context<RevokeGrant>) -> Result<()> {
        let grant = &mut ctx.accounts.grant;
        require!(
            grant.status == GrantStatus::Active,
            GrantError::GrantNotActive
        );
        grant.status = GrantStatus::Revoked;

        msg!(
            "Grant revoked: patient={}, grantee={}",
            ctx.accounts.patient.key(),
            grant.grantee
        );
        Ok(())
    }

    /// Emergency access grant — requires dual authorization (clinician + supervisor).
    /// Scope is always full emergency access, duration capped at 4 hours.
    pub fn emergency_grant(
        ctx: Context<EmergencyGrant>,
        re_encryption_key: [u8; 48],
        reason: String,
    ) -> Result<()> {
        require!(reason.len() <= 256, GrantError::ReasonTooLong);

        let now = Clock::get()?.unix_timestamp;
        let grant = &mut ctx.accounts.grant;
        grant.patient = ctx.accounts.patient_passport.key();
        grant.grantee = ctx.accounts.clinician.key();
        grant.scope = AccessScope {
            record_types: vec![],  // empty = all types
            departments: vec![],   // empty = all departments
            read: true,
            write: true,
            emergency: true,
        };
        grant.re_encryption_key = re_encryption_key;
        grant.valid_from = now;
        grant.valid_until = now + 14400; // 4 hours max
        grant.max_accesses = None;
        grant.access_count = 0;
        grant.status = GrantStatus::Active;
        grant.grant_reason = reason;
        grant.nonce = now as u64; // use timestamp as nonce for emergency
        grant.bump = ctx.bumps.grant;

        msg!(
            "EMERGENCY GRANT: clinician={}, supervisor={}, patient_passport={}",
            ctx.accounts.clinician.key(),
            ctx.accounts.supervisor.key(),
            ctx.accounts.patient_passport.key()
        );
        Ok(())
    }

    /// Permissionless crank to expire grants past their valid_until time.
    pub fn expire_grant(ctx: Context<ExpireGrant>) -> Result<()> {
        let grant = &mut ctx.accounts.grant;
        let now = Clock::get()?.unix_timestamp;

        require!(
            grant.status == GrantStatus::Active,
            GrantError::GrantNotActive
        );
        require!(now > grant.valid_until, GrantError::GrantNotExpired);

        grant.status = GrantStatus::Expired;
        msg!("Grant expired: {}", grant.key());
        Ok(())
    }
}

// === Accounts ===

#[derive(Accounts)]
#[instruction(scope: AccessScope, re_encryption_key: [u8; 48], duration_seconds: i64, max_accesses: Option<u32>, grant_reason: String, nonce: u64)]
pub struct CreateGrant<'info> {
    #[account(mut)]
    pub patient: Signer<'info>,

    /// CHECK: The clinician receiving the grant
    pub grantee: UncheckedAccount<'info>,

    #[account(
        init,
        payer = patient,
        space = AccessGrant::SPACE,
        seeds = [
            b"grant",
            patient.key().as_ref(),
            grantee.key().as_ref(),
            &nonce.to_le_bytes(),
        ],
        bump
    )]
    pub grant: Account<'info, AccessGrant>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UseGrant<'info> {
    pub grantee: Signer<'info>,

    #[account(
        mut,
        constraint = grant.grantee == grantee.key() @ GrantError::Unauthorized
    )]
    pub grant: Account<'info, AccessGrant>,
}

#[derive(Accounts)]
pub struct RevokeGrant<'info> {
    pub patient: Signer<'info>,

    #[account(
        mut,
        constraint = grant.patient == patient.key() @ GrantError::Unauthorized
    )]
    pub grant: Account<'info, AccessGrant>,
}

#[derive(Accounts)]
#[instruction(re_encryption_key: [u8; 48], reason: String)]
pub struct EmergencyGrant<'info> {
    #[account(mut)]
    pub clinician: Signer<'info>,

    /// Second signer required for dual authorization
    pub supervisor: Signer<'info>,

    /// CHECK: Patient passport PDA
    pub patient_passport: UncheckedAccount<'info>,

    #[account(
        init,
        payer = clinician,
        space = AccessGrant::SPACE,
        seeds = [
            b"grant",
            patient_passport.key().as_ref(),
            clinician.key().as_ref(),
            &Clock::get()?.unix_timestamp.to_le_bytes(),
        ],
        bump
    )]
    pub grant: Account<'info, AccessGrant>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExpireGrant<'info> {
    #[account(mut)]
    pub grant: Account<'info, AccessGrant>,
}

// === State ===

#[account]
pub struct AccessGrant {
    pub patient: Pubkey,
    pub grantee: Pubkey,
    pub scope: AccessScope,
    pub re_encryption_key: [u8; 48],
    pub valid_from: i64,
    pub valid_until: i64,
    pub max_accesses: Option<u32>,
    pub access_count: u32,
    pub status: GrantStatus,
    pub grant_reason: String,
    pub nonce: u64,
    pub bump: u8,
}

impl AccessGrant {
    pub const SPACE: usize = 8 + 32 + 32 + AccessScope::SPACE + 48 + 8 + 8 + (1 + 4)
        + 4 + 1 + (4 + 256) + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AccessScope {
    /// Record types accessible (empty = all)
    pub record_types: Vec<u8>,
    /// Department codes accessible (empty = all)
    pub departments: Vec<String>,
    pub read: bool,
    pub write: bool,
    pub emergency: bool,
}

impl AccessScope {
    pub const SPACE: usize = (4 + 8 * 1) + (4 + 3 * (4 + 32)) + 1 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum GrantStatus {
    Active,
    Expired,
    Revoked,
}

// === Errors ===

#[error_code]
pub enum GrantError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Grant reason too long (max 256 chars)")]
    ReasonTooLong,
    #[msg("Duration must be positive")]
    InvalidDuration,
    #[msg("Grant is not in Active status")]
    GrantNotActive,
    #[msg("Grant is not yet valid")]
    GrantNotYetValid,
    #[msg("Grant has expired")]
    GrantExpired,
    #[msg("Maximum access count reached")]
    MaxAccessesReached,
    #[msg("Grant has not expired yet")]
    GrantNotExpired,
}
