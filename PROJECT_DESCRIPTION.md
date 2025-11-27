# Project Description

**Deployed Frontend URL:** https://psy-real-estate.fly.dev

**Solana Program ID:** 3U6NSTN5Pm9VaMeTCdYq9RFUddeStn4zn63uXm33dr4A

## Project Overview

### Description
Real Estate Vaults is a simple crowdfunding primitive for property deals on Solana. Each property is registered on-chain with human-readable metadata (name + image URL) via `create_property`, then mapped to a deterministic vault PDA that escrows SOL contributed by backers. Contributors can top up the same property multiple times, monitor their running balance, and exit whenever they like. A Squads multisig (configured on-chain) is the only entity that can sweep funds from a property vault once a deal is ready to close. The dApp demonstrates PDA-driven state isolation, lamport accounting with rent padding, contributor-controlled withdrawals, and a registry-driven property catalogue, providing a safe baseline for real estate syndicates.

### Key Features
- **Property registry + metadata** – `create_property` increments a registry PDA (`b"property_registry"`), stores property metadata in a dedicated `Property` account, and returns a numeric ID the frontend can display.
- **Deterministic vault creation** – property vault accounts are derived from `b"property_vault"` and the property ID, so anyone can fund a listing trustlessly.
- **Per-user payment history** – each wallet/property pair stores its deposits inside a payment record PDA, enabling auto top-ups and preventing duplicate accounts.
- **Self-service withdrawals** – contributors can withdraw any portion of their balance at any time; payment records track the amount left and whether it has been fully withdrawn.
- **Multisig-controlled settlement** – only the configured Squads multisig key can call `withdraw_master`, allowing operators to settle properties once the raise completes.
- **Fly.io hosted UI** – the Next.js frontend on https://psy-real-estate.fly.dev provides simple forms to fund a property ID, review balances, and withdraw.
  
### How to Use the dApp
1. **Connect Wallet** – open the Fly.io deployment, connect a Devnet wallet (Phantom, Backpack, etc.), and make sure it holds SOL.
2. **Fund a property** – enter the numeric property ID and the SOL amount you want to stake, then submit to call `fund_property`; if the vault does not exist yet it will be created automatically.
3. **Top up or monitor** – repeat the funding flow to add more SOL to the same property, or load your payment record to see the updated lamport balance.
4. **Withdraw contributions** – choose a property you previously funded, specify the desired withdrawal amount, and invoke `withdraw_my_payment`; balances update immediately.
5. **Operator settlement** – when a raise succeeds, the Squads multisig signs a `withdraw_master` transaction to move capital from the property vault into the treasury wallet.
6. **Create new listings** – administrators wallet-sign `create_property` from the CLI or a future admin UI to add properties (name + image URL) into the on-chain registry without redeploying.

## Program Architecture
The Anchor program exposes four instructions across three major account types. `create_property` initialises (or reuses) the global property registry PDA, allocates a `Property` account that stores metadata, and increments the auto-incrementing property ID counter. `fund_property` moves lamports from the user into the property vault PDA, initialising it and the user payment record if necessary, and tracking the cumulative deposit. `withdraw_my_payment` enforces that only the owner can pull money out, that the payment record has funds remaining, and that the vault holds enough lamports. `withdraw_master` restricts execution to the Squads multisig, guaranteeing a secure settlement path. All vaults are rent exempt, PDAs derive deterministically from property IDs so the frontend can recreate addresses without on-chain lookups, and the registry bump is stored so the program can be redeployed without losing state.

### PDA Usage
**PDAs Used:**
- **Property Registry PDA** – seeds: `[b"property_registry"]`. Stores the next property ID counter and bump and is initialised lazily via `create_property`.
- **Property Vault PDA** – seeds: `[b"property_vault", property_id.to_le_bytes()]`. Stores the lamports collected for a property and anchors the vault bump.
- **Payment Record PDA** – seeds: `[b"payment", property_id.to_le_bytes(), payer_pubkey]`. Keeps per-user balances, withdrawn flag, and ensures only the owner can withdraw.

### Program Instructions
**Instructions Implemented:**
- **create_property(name: String, image_url: String)** – initialises the registry PDA if needed, allocates a new `Property` account, validates name/URL length, and assigns an auto-incrementing property ID.
- **fund_property(property_id: u32, amount: u64)** – transfers lamports into the property vault, initialises or updates the payer's payment record, and accumulates deposits for repeat contributors.
- **withdraw_my_payment(property_id: u32, amount: u64)** – lets contributors redeem part or all of their balance. Enforces seed + ownership constraints, checks vault liquidity, decrements balances, and marks the record as withdrawn when it hits zero.
- **withdraw_master(property_id: u32, amount: u64)** – gated by the Squads multisig signer. On success it debits the property vault PDA and credits the multisig wallet for deal settlement or refunds.

### Account Structure
```rust
#[account]
pub struct PropertyRegistry {
    pub next_property_id: u32, // Auto-incrementing counter for new properties
    pub bump: u8,              // PDA bump to keep the registry address stable
}

#[account]
pub struct PropertyVault {
    pub property_id: u32, // Which property this vault represents
    pub bump: u8,         // PDA bump used for vault derivation
}

#[account]
pub struct PaymentRecord {
    pub property_id: u32, // Property ID tied to this deposit
    pub payer: Pubkey,    // Wallet that funded the property
    pub amount: u64,      // Current lamport balance the payer can withdraw
    pub withdrawn: bool,  // Flag set to true once amount reaches zero
    pub bump: u8,         // PDA bump for the payment record
}

#[account]
pub struct Property {
    pub property_id: u32, // ID allocated via the registry counter
    pub name: String,     // Display name rendered by the frontend
    pub image_url: String // Public image URL for UI cards
}
```

## Testing

### Test Coverage
The TypeScript suite in `anchor_project/tests/real_estate.ts` runs on Anchor's local validator and fully exercises the funding + withdrawal flow; an additional helper now wraps `create_property` for future admin tests.

**Happy Path Tests:**
- Creates rent-exempt property vaults and payment records when a user funds for the first time.
- Accumulates multiple deposits from the same payer into one payment record.
- Allows contributors to withdraw partial balances and keeps `withdrawn` false until the record hits zero.
- Marks payment records as withdrawn after a full redemption and rejects further withdrawals.

**Unhappy Path Tests:**
- Prevents non-owners from withdrawing someone else's deposit via PDA seed/has_one constraints (`ConstraintSeeds`).
- Rejects withdrawal requests that exceed the tracked amount (`InsufficientFunds`).
- Blocks contributors from retrying `withdraw_my_payment` after the record is marked as fully withdrawn (`AlreadyWithdrawn`).
- Ensures only the Squads multisig signer can call `withdraw_master` (`Unauthorized`).

### Running Tests
```bash
yarn install
anchor test
```

### Additional Notes for Evaluators
- The Squads multisig constant (`SQUADS_MULTISIG_PUBKEY`) lives in `programs/real_estate/src/lib.rs`; replace it with your production multisig before redeploying.
- The declared program ID (`3U6NSTN5Pm9VaMeTCdYq9RFUddeStn4zn63uXm33dr4A`) is live on Devnet; point Anchor CLI/Anchor.toml at `https://api.devnet.solana.com` when interacting. The Fly.io frontend and tests already target this deployment.
- Frontend interactions call into Devnet and expect wallets that already own SOL; use the Devnet faucet or `solana airdrop` before testing end to end.
