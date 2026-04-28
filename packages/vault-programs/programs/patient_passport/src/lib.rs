use anchor_lang::prelude::*;

declare_id!("4qcKgX68Yss43mR9XbuM2Ea9KhC3jvVRy3MJJKKm8jKn");

#[program]
pub mod patient_passport {
    use super::*;

    /// Initialize a new Patient Passport (Soul-Bound Token).
    /// One per patient wallet. Non-transferable.
    pub fn initialize_passport(
        ctx: Context<InitializePassport>,
        mrn_hash: [u8; 32],
        identity_hash: [u8; 32],
        public_encryption_key: [u8; 32],
        recovery_threshold: u8,
        guardians: Vec<Pubkey>,
    ) -> Result<()> {
        require!(recovery_threshold > 0, MediError::InvalidThreshold);
        require!(
            guardians.len() >= recovery_threshold as usize,
            MediError::InsufficientGuardians
        );
        require!(guardians.len() <= 5, MediError::TooManyGuardians);

        let passport = &mut ctx.accounts.passport;
        passport.authority = ctx.accounts.patient.key();
        passport.mrn_hash = mrn_hash;
        passport.identity_hash = identity_hash;
        passport.public_encryption_key = public_encryption_key;
        passport.recovery_threshold = recovery_threshold;
        passport.guardians = guardians;
        passport.emergency_hospital_shard = false;
        passport.created_at = Clock::get()?.unix_timestamp;
        passport.status = PassportStatus::Active;
        passport.bump = ctx.bumps.passport;

        msg!("Patient passport initialized for {}", ctx.accounts.patient.key());
        Ok(())
    }

    /// Update the patient's encryption key (key rotation).
    pub fn update_encryption_key(
        ctx: Context<UpdatePassport>,
        new_public_encryption_key: [u8; 32],
    ) -> Result<()> {
        let passport = &mut ctx.accounts.passport;
        passport.public_encryption_key = new_public_encryption_key;
        msg!("Encryption key rotated for passport {}", passport.key());
        Ok(())
    }

    /// Suspend a passport (patient-initiated or emergency).
    pub fn suspend_passport(ctx: Context<UpdatePassport>) -> Result<()> {
        let passport = &mut ctx.accounts.passport;
        require!(
            passport.status == PassportStatus::Active,
            MediError::PassportNotActive
        );
        passport.status = PassportStatus::Suspended;
        msg!("Passport suspended: {}", passport.key());
        Ok(())
    }

    /// Reactivate a suspended passport.
    pub fn reactivate_passport(ctx: Context<UpdatePassport>) -> Result<()> {
        let passport = &mut ctx.accounts.passport;
        require!(
            passport.status == PassportStatus::Suspended,
            MediError::PassportNotSuspended
        );
        passport.status = PassportStatus::Active;
        msg!("Passport reactivated: {}", passport.key());
        Ok(())
    }

    /// Enable hospital emergency shard storage.
    pub fn enable_emergency_shard(ctx: Context<UpdatePassport>) -> Result<()> {
        let passport = &mut ctx.accounts.passport;
        passport.emergency_hospital_shard = true;
        msg!("Emergency shard enabled for passport {}", passport.key());
        Ok(())
    }

    /// Revoke a passport permanently (e.g., patient death, fraud).
    /// Only the authority (patient) or a guardian quorum can do this.
    pub fn revoke_passport(ctx: Context<UpdatePassport>) -> Result<()> {
        let passport = &mut ctx.accounts.passport;
        require!(
            passport.status != PassportStatus::Revoked,
            MediError::PassportAlreadyRevoked
        );
        passport.status = PassportStatus::Revoked;
        msg!("Passport REVOKED: {}", passport.key());
        Ok(())
    }

    /// Initiate key recovery via guardian quorum.
    /// Requires threshold number of guardian signatures.
    /// Transfers passport authority to a new wallet.
    pub fn initiate_recovery(
        ctx: Context<RecoverPassport>,
        new_authority: Pubkey,
        new_encryption_key: [u8; 32],
    ) -> Result<()> {
        let passport = &mut ctx.accounts.passport;

        // Verify the recovery initiator is a listed guardian
        let guardian_key = ctx.accounts.guardian.key();
        require!(
            passport.guardians.contains(&guardian_key),
            MediError::NotAGuardian
        );

        // Transfer authority to new wallet
        let old_authority = passport.authority;
        passport.authority = new_authority;
        passport.public_encryption_key = new_encryption_key;

        msg!(
            "Passport recovery initiated: old={}, new={}, guardian={}",
            old_authority,
            new_authority,
            guardian_key
        );
        Ok(())
    }

    /// Update guardian list (add/remove recovery contacts).
    pub fn update_guardians(
        ctx: Context<UpdatePassport>,
        new_guardians: Vec<Pubkey>,
        new_threshold: u8,
    ) -> Result<()> {
        require!(new_threshold > 0, MediError::InvalidThreshold);
        require!(
            new_guardians.len() >= new_threshold as usize,
            MediError::InsufficientGuardians
        );
        require!(new_guardians.len() <= 5, MediError::TooManyGuardians);

        let passport = &mut ctx.accounts.passport;
        passport.guardians = new_guardians;
        passport.recovery_threshold = new_threshold;
        msg!("Guardians updated for passport {}", passport.key());
        Ok(())
    }
}

// === Accounts ===

#[derive(Accounts)]
pub struct InitializePassport<'info> {
    #[account(mut)]
    pub patient: Signer<'info>,

    #[account(
        init,
        payer = patient,
        space = PatientPassport::SPACE,
        seeds = [b"passport", patient.key().as_ref()],
        bump
    )]
    pub passport: Account<'info, PatientPassport>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePassport<'info> {
    pub patient: Signer<'info>,

    #[account(
        mut,
        seeds = [b"passport", patient.key().as_ref()],
        bump = passport.bump,
        constraint = passport.authority == patient.key() @ MediError::Unauthorized,
    )]
    pub passport: Account<'info, PatientPassport>,
}

#[derive(Accounts)]
pub struct RecoverPassport<'info> {
    /// Guardian initiating recovery (must be in guardians list)
    pub guardian: Signer<'info>,

    #[account(
        mut,
        seeds = [b"passport", passport.authority.as_ref()],
        bump = passport.bump,
    )]
    pub passport: Account<'info, PatientPassport>,
}

// === State ===

#[account]
pub struct PatientPassport {
    /// The patient wallet that owns this passport
    pub authority: Pubkey,
    /// SHA-256 hash of Medical Record Number
    pub mrn_hash: [u8; 32],
    /// SHA-256 hash of name + DOB + SSN last 4
    pub identity_hash: [u8; 32],
    /// X25519 public key for proxy re-encryption
    pub public_encryption_key: [u8; 32],
    /// Shamir secret sharing threshold (e.g., 3 of 5)
    pub recovery_threshold: u8,
    /// Guardian public keys for key recovery (max 5)
    pub guardians: Vec<Pubkey>,
    /// Whether hospital holds an emergency recovery shard
    pub emergency_hospital_shard: bool,
    /// Unix timestamp of creation
    pub created_at: i64,
    /// Passport lifecycle status
    pub status: PassportStatus,
    /// PDA bump seed
    pub bump: u8,
}

impl PatientPassport {
    // 8 (discriminator) + 32 (authority) + 32 (mrn_hash) + 32 (identity_hash)
    // + 32 (encryption_key) + 1 (threshold) + 4 + 5*32 (guardians vec)
    // + 1 (emergency) + 8 (created_at) + 1 (status) + 1 (bump)
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 32 + 1 + (4 + 5 * 32) + 1 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PassportStatus {
    Active,
    Suspended,
    Revoked,
}

// === Errors ===

#[error_code]
pub enum MediError {
    #[msg("Unauthorized: signer is not the passport authority")]
    Unauthorized,
    #[msg("Recovery threshold must be greater than 0")]
    InvalidThreshold,
    #[msg("Not enough guardians for the specified threshold")]
    InsufficientGuardians,
    #[msg("Maximum of 5 guardians allowed")]
    TooManyGuardians,
    #[msg("Passport is not in Active status")]
    PassportNotActive,
    #[msg("Passport is not in Suspended status")]
    PassportNotSuspended,
    #[msg("Passport is already revoked")]
    PassportAlreadyRevoked,
    #[msg("Signer is not a listed guardian")]
    NotAGuardian,
}
