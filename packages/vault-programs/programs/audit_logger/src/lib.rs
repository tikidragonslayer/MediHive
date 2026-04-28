use anchor_lang::prelude::*;

declare_id!("FQMNRzPZj8QFDy6akX6EX79mrgUHKaCzSgrNuAJTk8is");

#[program]
pub mod audit_logger {
    use super::*;

    /// Log an audit event. Append-only — cannot be amended or deleted.
    /// In production, this would use compressed NFTs (Bubblegum) for cost efficiency.
    /// For the prototype, we use regular accounts.
    pub fn log_event(
        ctx: Context<LogEvent>,
        action: AuditAction,
        target_patient: Pubkey,
        target_record: Option<Pubkey>,
        ip_hash: [u8; 32],
        device_hash: [u8; 32],
        metadata: String,
    ) -> Result<()> {
        require!(metadata.len() <= 512, AuditError::MetadataTooLong);

        let entry = &mut ctx.accounts.audit_entry;
        entry.actor = ctx.accounts.actor.key();
        entry.action = action;
        entry.target_patient = target_patient;
        entry.target_record = target_record;
        entry.timestamp = Clock::get()?.unix_timestamp;
        entry.ip_hash = ip_hash;
        entry.device_hash = device_hash;
        entry.metadata = metadata;
        entry.bump = ctx.bumps.audit_entry;

        msg!(
            "Audit: actor={}, action={:?}, patient={}, ts={}",
            entry.actor,
            entry.action,
            entry.target_patient,
            entry.timestamp
        );
        Ok(())
    }
}

// === Accounts ===

#[derive(Accounts)]
#[instruction(action: AuditAction, target_patient: Pubkey, target_record: Option<Pubkey>, ip_hash: [u8; 32], device_hash: [u8; 32], metadata: String)]
pub struct LogEvent<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,

    #[account(
        init,
        payer = actor,
        space = AuditEntry::SPACE,
        seeds = [
            b"audit",
            actor.key().as_ref(),
            &Clock::get()?.unix_timestamp.to_le_bytes(),
        ],
        bump
    )]
    pub audit_entry: Account<'info, AuditEntry>,

    pub system_program: Program<'info, System>,
}

// === State ===

#[account]
pub struct AuditEntry {
    pub actor: Pubkey,
    pub action: AuditAction,
    pub target_patient: Pubkey,
    pub target_record: Option<Pubkey>,
    pub timestamp: i64,
    pub ip_hash: [u8; 32],
    pub device_hash: [u8; 32],
    pub metadata: String,
    pub bump: u8,
}

impl AuditEntry {
    pub const SPACE: usize = 8 + 32 + 1 + 32 + (1 + 32) + 8 + 32 + 32 + (4 + 512) + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum AuditAction {
    View,
    Create,
    Amend,
    Void,
    Grant,
    Revoke,
    EmergencyAccess,
    BreakGlass,
    ConsentChange,
    Export,
    KeyRotation,
}

// === Errors ===

#[error_code]
pub enum AuditError {
    #[msg("Metadata string too long (max 512 chars)")]
    MetadataTooLong,
}
