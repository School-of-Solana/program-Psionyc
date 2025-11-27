use anchor_lang::prelude::*;
use anchor_lang::system_program;
use std::str::FromStr;

declare_id!("3U6NSTN5Pm9VaMeTCdYq9RFUddeStn4zn63uXm33dr4A");

// **Replace this with your real Squads multisig pubkey**
const SQUADS_MULTISIG_PUBKEY: &str = "6KrYBHTXzJjn78L4aJGpocQwiJEoV1yqu6HNqgFixEYE";
const MAX_PROPERTY_NAME_LEN: usize = 64;
const MAX_IMAGE_URL_LEN: usize = 200;

#[program]
pub mod real_estate {
    use super::*;

    pub fn create_property(
        ctx: Context<CreateProperty>,
        name: String,
        image_url: String,
    ) -> Result<()> {
        require!(name.len() <= MAX_PROPERTY_NAME_LEN, ErrorCode::NameTooLong);
        require!(
            image_url.len() <= MAX_IMAGE_URL_LEN,
            ErrorCode::ImageUrlTooLong
        );

        let registry = &mut ctx.accounts.registry;
        let property = &mut ctx.accounts.property;

        let property_id = registry.next_property_id;
        property.property_id = property_id;
        property.name = name;
        property.image_url = image_url;

        registry.next_property_id = registry
            .next_property_id
            .checked_add(1)
            .ok_or(ErrorCode::IdOverflow)?;
        

        Ok(())
    }

    pub fn fund_property(ctx: Context<FundProperty>, property_id: u32, amount: u64) -> Result<()> {
        // 1️⃣ Move lamports into the vault PDA
        let cpi = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.property_vault.to_account_info(),
            },
        );
        system_program::transfer(cpi, amount)?;

        // 2️⃣ Populate vault data
        let vault = &mut ctx.accounts.property_vault;
        vault.property_id = property_id;
        // vault.bump = *ctx.bumps.get("property_vault").unwrap();

        // 3️⃣ Initialise or update the payment record
        let rec = &mut ctx.accounts.payment_record;
        if rec.payer == Pubkey::default() {
            // first time ever
            rec.payer = ctx.accounts.payer.key();
            rec.property_id = property_id;
            rec.amount = amount;
        } else if rec.withdrawn {
            // they’d withdrawn all before, now fresh deposit
            rec.property_id = property_id;
            rec.amount = amount;
        } else {
            // topping up
            rec.amount = rec.amount.saturating_add(amount);
        }
        rec.withdrawn = false; // unlock it
                               // rec.bump = *ctx.bumps.get("payment_record").unwrap();

        Ok(())
    }

    pub fn withdraw_my_payment(
        ctx: Context<WithdrawMyPayment>,
        _property_id: u32,
        amount: u64,
    ) -> Result<()> {
        let rec = &mut ctx.accounts.payment_record;
        let vault = &mut ctx.accounts.property_vault.to_account_info();
        let to = &mut ctx.accounts.payer.to_account_info();

        // Ensure they can't withdraw more than they've deposited
        require!(amount <= rec.amount, ErrorCode::InsufficientFunds);
        require!(
            **vault.lamports.borrow() >= amount,
            ErrorCode::VaultInsufficientFunds
        );

        **vault.try_borrow_mut_lamports()? -= amount;
        **to.try_borrow_mut_lamports()? += amount;

        // Decrease remaining balance, mark withdrawn only if zero
        rec.amount -= amount;
        if rec.amount == 0 {
            rec.withdrawn = true;
        }

        Ok(())
    }

    pub fn withdraw_master(
        ctx: Context<WithdrawMaster>,
        _property_id: u32,
        amount: u64,
    ) -> Result<()> {
        // 1️⃣ Check only your Squads multisig key can call this

        let expected =
            Pubkey::from_str(SQUADS_MULTISIG_PUBKEY).map_err(|_| ErrorCode::Unauthorized)?;
        require!(
            ctx.accounts.master.key() == expected,
            ErrorCode::Unauthorized
        );

        // 2️⃣ Move lamports out to the multisig signer
        let vault = &mut ctx.accounts.property_vault.to_account_info();
        let master = &mut ctx.accounts.master.to_account_info();

        require!(
            **vault.lamports.borrow() >= amount,
            ErrorCode::VaultInsufficientFunds
        );

        **vault.try_borrow_mut_lamports()? -= amount;
        **master.try_borrow_mut_lamports()? += amount;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateProperty<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init_if_needed,
        payer = creator,
        space = PropertyRegistry::SPACE,
        seeds = [b"property_registry"],
        bump
    )]
    pub registry: Account<'info, PropertyRegistry>,

    #[account(
        init,
        payer = creator,
        space = Property::SPACE,
    )]
    pub property: Account<'info, Property>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(property_id: u32)]
pub struct FundProperty<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Create the vault on first use, else just load it
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 4 + 1 + 32, // discriminator + u32 + u8 + Pubkey
        seeds = [b"property_vault", property_id.to_le_bytes().as_ref()],
        bump
    )]
    pub property_vault: Account<'info, PropertyVault>,

    /// One record per (user, property). Updated, not re-created.
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 4 + 32 + 8 + 1 + 1, // discriminator + u32 + pubkey + u64 + bool + bump
        seeds = [
            b"payment",
            property_id.to_le_bytes().as_ref(),
            payer.key().as_ref()
        ],
        bump
    )]
    pub payment_record: Account<'info, PaymentRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(property_id: u32)]
pub struct WithdrawMyPayment<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"payment",
            property_id.to_le_bytes().as_ref(),
            payer.key().as_ref()
        ],
        bump,
        has_one = payer,
        constraint = payment_record.withdrawn == false @ ErrorCode::AlreadyWithdrawn
    )]
    pub payment_record: Account<'info, PaymentRecord>,

    #[account(
        mut,
        seeds = [b"property_vault", property_id.to_le_bytes().as_ref()],
        bump
    )]
    pub property_vault: Account<'info, PropertyVault>,
}

#[derive(Accounts)]
#[instruction(property_id: u32)]
pub struct WithdrawMaster<'info> {
    /// Only this multisig key may sign
    #[account(mut)]
    pub master: Signer<'info>,

    #[account(
        mut,
        seeds = [b"property_vault", property_id.to_le_bytes().as_ref()],
        bump
    )]
    pub property_vault: Account<'info, PropertyVault>,
}

#[account]
pub struct PropertyRegistry {
    pub next_property_id: u32,
    pub bump: u8,
}

impl PropertyRegistry {
    pub const SPACE: usize = 8 + 4 + 1;
}

#[account]
pub struct PropertyVault {
    pub property_id: u32,
    pub bump: u8,
}

#[account]
pub struct PaymentRecord {
    pub property_id: u32,
    pub payer: Pubkey,
    pub amount: u64,
    pub withdrawn: bool,
    pub bump: u8,
}

#[account]
pub struct Property {
    pub property_id: u32,
    pub name: String,
    pub image_url: String,
}

impl Property {
    pub const SPACE: usize = 8 + 4 + 4 + MAX_PROPERTY_NAME_LEN + 4 + MAX_IMAGE_URL_LEN;

    pub fn create_property(id: u32, name: String, image_url: String) -> Self {
        Self {
            property_id: id,
            name,
            image_url,
        }
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Payment already withdrawn")]
    AlreadyWithdrawn,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient deposit balance")]
    InsufficientFunds,
    #[msg("Insufficient funds in the vault")]
    VaultInsufficientFunds,
    #[msg("Property name too long")]
    NameTooLong,
    #[msg("Image URL too long")]
    ImageUrlTooLong,
    #[msg("Property id overflow")]
    IdOverflow,
}
