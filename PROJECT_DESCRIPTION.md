# Project Description

**Deployed Frontend URL:** https://psy-real-estate.fly.dev

**Solana Program ID:** 3U6NSTN5Pm9VaMeTCdYq9RFUddeStn4zn63uXm33dr4A

## Project Overview

### Description
Real Estate Vaults is a simple crowdfunding primitive for property deals on Solana. Every property is mapped to a deterministic vault PDA that escrows SOL contributed by backers. Contributors can top up the same property multiple times, monitor their running balance, and exit whenever they like. A Squads multisig (configured on-chain) is the only entity that can sweep funds from a property vault once a deal is ready to close. The dApp demonstrates PDA-driven state isolation, lamport accounting with rent padding, and contributor-controlled withdrawals, providing a safe baseline for real estate syndicates.

### Key Features
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

## Program Architecture
The Anchor program exposes three instructions and two PDA-backed accounts. `fund_property` moves lamports from the user into the property vault PDA, initialising it + the user payment record if necessary, and tracking the cumulative deposit. `withdraw_my_payment` enforces that only the owner can pull money out, that the payment record has funds remaining, and that the vault holds enough lamports. `withdraw_master` restricts execution to the Squads multisig, guaranteeing a secure settlement path. All vaults are rent exempt, and PDAs are derived deterministically from property IDs so the frontend can recreate addresses without on-chain lookups.

### PDA Usage
**PDAs Used:**
- **Property Vault PDA** – seeds: `[b"property_vault", property_id.to_le_bytes()]`. Stores the lamports collected for a property and anchors the vault bump.
- **Payment Record PDA** – seeds: `[b"payment", property_id.to_le_bytes(), payer_pubkey]`. Keeps per-user balances, withdrawn flag, and ensures only the owner can withdraw.

### Program Instructions
**Instructions Implemented:**
- **fund_property(property_id: u32, amount: u64)** – transfers lamports into the property vault, initialises or updates the payer's payment record, and accumulates deposits for repeat contributors.
- **withdraw_my_payment(property_id: u32, amount: u64)** – lets contributors redeem part or all of their balance. Enforces seed + ownership constraints, checks vault liquidity, decrements balances, and marks the record as withdrawn when it hits zero.
- **withdraw_master(property_id: u32, amount: u64)** – gated by the Squads multisig signer. On success it debits the property vault PDA and credits the multisig wallet for deal settlement or refunds.

### Account Structure
```rust
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
```

## Testing

### Test Coverage
The TypeScript suite in `anchor_project/tests/real_estate.ts` runs on Anchor's local validator and exercises all instructions with both happy and unhappy paths.

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
- The Squads multisig placeholder constant (`SQUADS_MULTISIG_PUBKEY`) lives in `programs/real_estate/src/lib.rs`; swap it with your production multisig if you redeploy.
- The Anchor provider is set to `localnet` inside `Anchor.toml` for development, but the declared program ID above is deployed on Devnet. Update `provider.cluster` before redeploying.
- Frontend interactions call into Devnet and expect wallets that already own SOL; use the Devnet faucet or `solana airdrop` before testing end to end.
