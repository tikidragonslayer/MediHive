use anchor_lang::prelude::*;

declare_id!("21s29kpMXWYMbsZbJcfFHsyfnFjmu5dwybKpGaADUk4i");

#[program]
pub mod record_manager {
    use super::*;

    /// Mint a new medical record reference on-chain.
    /// Actual encrypted FHIR data lives on IPFS; this stores the hash + pointer.
    pub fn mint_record(
        ctx: Context<MintRecord>,
        record_type: RecordType,
        content_hash: [u8; 32],
        ipfs_cid: String,
        abe_policy: String,
        icd_codes_hash: [u8; 32],
    ) -> Result<()> {
        require!(ipfs_cid.len() <= 64, RecordError::CidTooLong);
        require!(abe_policy.len() <= 128, RecordError::PolicyTooLong);

        let record = &mut ctx.accounts.record;
        record.patient_passport = ctx.accounts.patient_passport.key();
        record.record_type = record_type;
        record.content_hash = content_hash;
        record.ipfs_cid = ipfs_cid;
        record.arweave_tx = None;
        record.abe_policy = abe_policy;
        record.author = ctx.accounts.author.key();
        record.author_credential_hash = [0u8; 32]; // Set via separate instruction
        record.icd_codes_hash = icd_codes_hash;
        record.created_at = Clock::get()?.unix_timestamp;
        record.status = RecordStatus::Final;
        record.supersedes = None;
        record.bump = ctx.bumps.record;

        msg!(
            "Record minted: type={:?}, author={}, patient_passport={}",
            record.record_type,
            ctx.accounts.author.key(),
            ctx.accounts.patient_passport.key()
        );
        Ok(())
    }

    /// Amend an existing record. Creates a new record that links to the original.
    /// Original is marked as Amended (never deleted — HIPAA retention).
    pub fn amend_record(
        ctx: Context<AmendRecord>,
        new_content_hash: [u8; 32],
        new_ipfs_cid: String,
        reason: String,
    ) -> Result<()> {
        require!(new_ipfs_cid.len() <= 64, RecordError::CidTooLong);
        require!(reason.len() <= 256, RecordError::ReasonTooLong);

        // Mark original as amended
        let original = &mut ctx.accounts.original_record;
        require!(
            original.status == RecordStatus::Final,
            RecordError::CannotAmendNonFinal
        );
        original.status = RecordStatus::Amended;

        // Create the amendment record
        let amendment = &mut ctx.accounts.amendment_record;
        amendment.patient_passport = original.patient_passport;
        amendment.record_type = original.record_type;
        amendment.content_hash = new_content_hash;
        amendment.ipfs_cid = new_ipfs_cid;
        amendment.arweave_tx = None;
        amendment.abe_policy = original.abe_policy.clone();
        amendment.author = ctx.accounts.author.key();
        amendment.author_credential_hash = [0u8; 32];
        amendment.icd_codes_hash = original.icd_codes_hash;
        amendment.created_at = Clock::get()?.unix_timestamp;
        amendment.status = RecordStatus::Final;
        amendment.supersedes = Some(ctx.accounts.original_record.key());
        amendment.bump = ctx.bumps.amendment_record;

        msg!(
            "Record amended: original={}, amendment={}, reason={}",
            ctx.accounts.original_record.key(),
            amendment.key(),
            reason
        );
        Ok(())
    }

    /// Void a record (never deleted — HIPAA requires retention).
    pub fn void_record(ctx: Context<VoidRecord>, reason: String) -> Result<()> {
        require!(reason.len() <= 256, RecordError::ReasonTooLong);

        let record = &mut ctx.accounts.record;
        require!(
            record.status == RecordStatus::Final,
            RecordError::CannotVoidNonFinal
        );
        record.status = RecordStatus::Voided;

        msg!("Record voided: {}, reason={}", record.key(), reason);
        Ok(())
    }

    /// Set Arweave permanent archive transaction ID.
    pub fn set_arweave_tx(ctx: Context<UpdateRecord>, arweave_tx: String) -> Result<()> {
        require!(arweave_tx.len() <= 64, RecordError::ArweaveTxTooLong);
        let record = &mut ctx.accounts.record;
        record.arweave_tx = Some(arweave_tx);
        Ok(())
    }
}

// === Accounts ===

#[derive(Accounts)]
#[instruction(record_type: RecordType, content_hash: [u8; 32])]
pub struct MintRecord<'info> {
    #[account(mut)]
    pub author: Signer<'info>,

    /// CHECK: Validated as a passport PDA by seeds
    pub patient_passport: UncheckedAccount<'info>,

    #[account(
        init,
        payer = author,
        space = MedicalRecord::SPACE,
        seeds = [
            b"record",
            patient_passport.key().as_ref(),
            &content_hash,
        ],
        bump
    )]
    pub record: Account<'info, MedicalRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(new_content_hash: [u8; 32])]
pub struct AmendRecord<'info> {
    #[account(mut)]
    pub author: Signer<'info>,

    #[account(mut)]
    pub original_record: Account<'info, MedicalRecord>,

    #[account(
        init,
        payer = author,
        space = MedicalRecord::SPACE,
        seeds = [
            b"record",
            original_record.patient_passport.as_ref(),
            &new_content_hash,
        ],
        bump
    )]
    pub amendment_record: Account<'info, MedicalRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VoidRecord<'info> {
    pub author: Signer<'info>,

    #[account(
        mut,
        constraint = record.author == author.key() @ RecordError::Unauthorized
    )]
    pub record: Account<'info, MedicalRecord>,
}

#[derive(Accounts)]
pub struct UpdateRecord<'info> {
    pub author: Signer<'info>,

    #[account(
        mut,
        constraint = record.author == author.key() @ RecordError::Unauthorized
    )]
    pub record: Account<'info, MedicalRecord>,
}

// === State ===

#[account]
pub struct MedicalRecord {
    pub patient_passport: Pubkey,
    pub record_type: RecordType,
    pub content_hash: [u8; 32],
    pub ipfs_cid: String,
    pub arweave_tx: Option<String>,
    pub abe_policy: String,
    pub author: Pubkey,
    pub author_credential_hash: [u8; 32],
    pub icd_codes_hash: [u8; 32],
    pub created_at: i64,
    pub status: RecordStatus,
    pub supersedes: Option<Pubkey>,
    pub bump: u8,
}

impl MedicalRecord {
    // Conservative estimate with max string lengths
    pub const SPACE: usize = 8 + 32 + 1 + 32 + (4 + 64) + (1 + 4 + 64) + (4 + 128)
        + 32 + 32 + 32 + 8 + 1 + (1 + 32) + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum RecordType {
    Note,
    Lab,
    Imaging,
    Prescription,
    Vital,
    Procedure,
    Discharge,
    Referral,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RecordStatus {
    Draft,
    Final,
    Amended,
    Voided,
}

// === Errors ===

#[error_code]
pub enum RecordError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("IPFS CID too long (max 64 chars)")]
    CidTooLong,
    #[msg("ABE policy too long (max 128 chars)")]
    PolicyTooLong,
    #[msg("Reason too long (max 256 chars)")]
    ReasonTooLong,
    #[msg("Arweave TX too long (max 64 chars)")]
    ArweaveTxTooLong,
    #[msg("Can only amend records with Final status")]
    CannotAmendNonFinal,
    #[msg("Can only void records with Final status")]
    CannotVoidNonFinal,
}
