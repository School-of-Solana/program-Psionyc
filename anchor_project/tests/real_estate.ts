import * as anchor from "@coral-xyz/anchor";
import { AnchorError, BN, Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { RealEstate } from "../target/types/real_estate";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = anchor.workspace.realEstate as Program<RealEstate>;
const connection = provider.connection;

const PROPERTY_VAULT_SPACE = 8 + 4 + 1 + 32;
const MASTER_MULTISIG = new PublicKey(
    "6KrYBHTXzJjn78L4aJGpocQwiJEoV1yqu6HNqgFixEYE"
);

const toPropertyBytes = (propertyId: number) => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(propertyId);
    return buffer;
};

const propertyVaultPda = (propertyId: number) =>
    PublicKey.findProgramAddressSync(
        [Buffer.from("property_vault"), toPropertyBytes(propertyId)],
        program.programId
    )[0];

const paymentRecordPda = (propertyId: number, payer: PublicKey) =>
    PublicKey.findProgramAddressSync(
        [Buffer.from("payment"), toPropertyBytes(propertyId), payer.toBuffer()],
        program.programId
    )[0];

const create_property = async (name: string, imageUrl: string) => {
    const property = Keypair.generate();
    const [registry] = PublicKey.findProgramAddressSync(
        [Buffer.from("property_registry")],
        program.programId
    );

    await program.methods
        .createProperty(name, imageUrl)
        .accounts({
            creator: provider.wallet.publicKey,
            
            property: property.publicKey,
        })
        .signers([property])
        .rpc();

    const propertyAccount = await program.account.property.fetch(property.publicKey);

    return { propertyPublicKey: property.publicKey, propertyAccount };
};

const expectAnchorError = async (promise: Promise<unknown>, code: string) => {
    try {
        await promise;
        expect.fail(`Expected Anchor error '${code}'`);
    } catch (error) {
        expect(error).to.be.instanceOf(AnchorError);
        const anchorError = error as AnchorError;
        expect(anchorError.error.errorCode.code).to.equal(code);
    }
};

const fundUser = async (lamports = 5 * LAMPORTS_PER_SOL) => {
    const newUser = Keypair.generate();
    const sig = await connection.requestAirdrop(newUser.publicKey, lamports);
    await connection.confirmTransaction(sig, "confirmed");
    return newUser;
};

const fundProperty = async (
    user: Keypair,
    propertyId: number,
    depositLamports: number
) => {
    const propertyVault = propertyVaultPda(propertyId);
    const paymentRecord = paymentRecordPda(propertyId, user.publicKey);

    await program.methods
        .fundProperty(propertyId, new BN(depositLamports))
        .accounts({
            payer: user.publicKey,

        })
        .signers([user])
        .rpc();

    return { propertyVault, paymentRecord };
};

const withdrawMyPayment = async (
    user: Keypair,
    propertyId: number,
    amount: number
) => {
    const propertyVault = propertyVaultPda(propertyId);
    const paymentRecord = paymentRecordPda(propertyId, user.publicKey);

    await program.methods
        .withdrawMyPayment(propertyId, new BN(amount))
        .accounts({
            payer: user.publicKey,
            paymentRecord,
            propertyVault,
        })
        .signers([user])
        .rpc();

    return { propertyVault, paymentRecord };
};

let propertyCounter = 0;
const nextPropertyId = () => {
    propertyCounter += 1;
    return propertyCounter;
};

describe("real_estate program", () => {
    it("creates rent exempt property vaults and payment records", async () => {
        const user = await fundUser();
        const propertyId = nextPropertyId();
        const depositLamports = LAMPORTS_PER_SOL / 2;

        const { propertyVault, paymentRecord } = await fundProperty(
            user,
            propertyId,
            depositLamports
        );

        const vaultAccount = await program.account.propertyVault.fetch(
            propertyVault
        );
        expect(vaultAccount.propertyId).to.equal(propertyId);

        const paymentAccount = await program.account.paymentRecord.fetch(
            paymentRecord
        );
        expect(paymentAccount.amount.toNumber()).to.equal(depositLamports);
        expect(paymentAccount.withdrawn).to.equal(false);
        expect(paymentAccount.payer.toBase58()).to.equal(
            user.publicKey.toBase58()
        );

        const rent = await connection.getMinimumBalanceForRentExemption(
            PROPERTY_VAULT_SPACE
        );
        const vaultLamports = await connection.getBalance(propertyVault);
        expect(vaultLamports).to.equal(rent + depositLamports);
    });

    it("accumulates deposits when a payer tops up the same property", async () => {
        const user = await fundUser();
        const propertyId = nextPropertyId();
        const firstDeposit = 700_000;
        const secondDeposit = 1_200_000;

        const { paymentRecord } = await fundProperty(
            user,
            propertyId,
            firstDeposit
        );
        await fundProperty(user, propertyId, secondDeposit);

        const paymentAccount = await program.account.paymentRecord.fetch(
            paymentRecord
        );
        expect(paymentAccount.amount.toNumber()).to.equal(
            firstDeposit + secondDeposit
        );
        expect(paymentAccount.withdrawn).to.equal(false);
    });

    it("lets contributors withdraw partial balances", async () => {
        const user = await fundUser();
        const propertyId = nextPropertyId();
        const depositLamports = 2_000_000;
        const withdrawLamports = 750_000;

        const { propertyVault, paymentRecord } = await fundProperty(
            user,
            propertyId,
            depositLamports
        );

        const vaultBefore = await connection.getBalance(propertyVault);

        await program.methods
            .withdrawMyPayment(propertyId, new BN(withdrawLamports))
            .accounts({
                payer: user.publicKey,
                paymentRecord,
                propertyVault,
            })
            .signers([user])
            .rpc();

        const vaultAfter = await connection.getBalance(propertyVault);
        expect(vaultBefore - vaultAfter).to.equal(withdrawLamports);

        const paymentAccount = await program.account.paymentRecord.fetch(
            paymentRecord
        );
        expect(paymentAccount.amount.toNumber()).to.equal(
            depositLamports - withdrawLamports
        );
        expect(paymentAccount.withdrawn).to.equal(false);
    });

    it("prevents random users from withdrawing someone else's deposit", async () => {
        const contributor = await fundUser();
        const attacker = await fundUser();
        const propertyId = nextPropertyId();
        const depositLamports = 1_500_000;

        const { propertyVault, paymentRecord } = await fundProperty(
            contributor,
            propertyId,
            depositLamports
        );

        await expectAnchorError(
            program.methods
                .withdrawMyPayment(propertyId, new BN(250_000))
                .accounts({
                    payer: attacker.publicKey,
                    paymentRecord,
                    propertyVault,
                })
                .signers([attacker])
                .rpc(),
            "ConstraintSeeds"
        );
    });

    it("marks payment records as withdrawn once fully drained", async () => {
        const user = await fundUser();
        const propertyId = nextPropertyId();
        const depositLamports = 900_000;

        const { paymentRecord, propertyVault } = await fundProperty(
            user,
            propertyId,
            depositLamports
        );

        await withdrawMyPayment(user, propertyId, depositLamports);

        const paymentAccount = await program.account.paymentRecord.fetch(
            paymentRecord
        );
        expect(paymentAccount.amount.toNumber()).to.equal(0);
        expect(paymentAccount.withdrawn).to.equal(true);

        await expectAnchorError(
            program.methods
                .withdrawMyPayment(propertyId, new BN(1))
                .accounts({
                    payer: user.publicKey,
                    paymentRecord,
                    propertyVault,
                })
                .signers([user])
                .rpc(),
            "AlreadyWithdrawn"
        );
    });

    it("rejects attempts to withdraw more than recorded", async () => {
        const user = await fundUser();
        const propertyId = nextPropertyId();
        const depositLamports = 500_000;

        const { propertyVault, paymentRecord } = await fundProperty(
            user,
            propertyId,
            depositLamports
        );

        await expectAnchorError(
            program.methods
                .withdrawMyPayment(propertyId, new BN(depositLamports + 1))
                .accounts({
                    payer: user.publicKey,
                    paymentRecord,
                    propertyVault,
                })
                .signers([user])
                .rpc(),
            "InsufficientFunds"
        );
    });

    it("rejects withdrawMaster when signer is not the Squads multisig", async () => {
        const contributor = await fundUser();
        const propertyId = nextPropertyId();
        const depositLamports = 2_500_000;

        const { propertyVault } = await fundProperty(
            contributor,
            propertyId,
            depositLamports
        );

        const unauthorized = await fundUser();

        await expectAnchorError(
            program.methods
                .withdrawMaster(propertyId, new BN(500_000))
                .accounts({
                    master: unauthorized.publicKey,
                })
                .signers([unauthorized])
                .rpc(),
            "Unauthorized"
        );
    });
});
