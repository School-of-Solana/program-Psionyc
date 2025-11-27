"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnchorProvider, BN, Program, type Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import { address } from "@solana/addresses";
import { AccountRole, type Instruction } from "@solana/instructions";
import {
  pipe,
  createTransactionMessage,
  appendTransactionMessageInstruction,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signAndSendTransactionMessageWithSigners,
  getBase58Decoder,
  type Signature,
} from "@solana/kit";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";

import { useSolana } from "@/components/solana_provider";
import { WalletConnectButton } from "@/components/wallet-connect-button";
import {
  PropertyCard,
  type PropertyMeta,
  type PropertySummary,
} from "@/components/property-card";
import {  type RealEstate } from "../../real_estate";
import REAL_ESTATE_IDL from "../../real_estate.json"

const PROGRAM_ID = new PublicKey(REAL_ESTATE_IDL.address);
const RPC_ENDPOINT = "https://api.devnet.solana.com";
const PAYMENT_SEED = new TextEncoder().encode("payment");
const VAULT_SEED = new TextEncoder().encode("property_vault");
const LAMPORTS_PER_SOL_BIGINT = BigInt(LAMPORTS_PER_SOL);

const PROPERTIES: PropertyMeta[] = [
  {
    id: 1,
    name: "Harbor View Lofts",
    location: "Miami, FL",
    highlight: "Tokenized waterfront rentals with projected 11.8% APY.",
    focus: "Backed by a 24-unit mixed-use building in Brickell.",
    tag: "Flagship",
    gradient: "from-sky-600 via-indigo-600 to-violet-500",
  },
  {
    id: 7,
    name: "Saguaro Villas",
    location: "Scottsdale, AZ",
    highlight: "Short-term luxury stays near TPC Scottsdale.",
    focus: "Revenue share across 8 designer villas.",
    tag: "Income",
    gradient: "from-amber-500 via-orange-500 to-rose-500",
  },
  {
    id: 21,
    name: "Cascade Ridge",
    location: "Denver, CO",
    highlight: "Suburban single-family rentals with long-term tenants.",
    focus: "Stabilized yield with conservative leverage.",
    tag: "Stability",
    gradient: "from-emerald-500 via-teal-500 to-cyan-500",
  },
];

type PropertyState = {
  vaultLamports: bigint | null;
  userAmount: bigint | null;
  withdrawn: boolean | null;
  loading: boolean;
};

type FeedbackState =
  | { variant: "success"; message: string; signature?: string }
  | { variant: "error"; message: string }
  | { variant: "info"; message: string };

const propertySeed = (propertyId: number) => {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, propertyId, true);
  return new Uint8Array(buffer);
};

const getVaultPda = (propertyId: number) =>
  PublicKey.findProgramAddressSync([
    VAULT_SEED,
    propertySeed(propertyId),
  ], PROGRAM_ID);

const getPaymentRecordPda = (propertyId: number, payer: PublicKey) =>
  PublicKey.findProgramAddressSync([
    PAYMENT_SEED,
    propertySeed(propertyId),
    payer.toBytes(),
  ], PROGRAM_ID);

const formatLamports = (lamports: bigint | null) => {
  if (lamports === null) return "—";
  const whole = lamports / LAMPORTS_PER_SOL_BIGINT;
  const fraction = lamports % LAMPORTS_PER_SOL_BIGINT;
  const fractionStr = fraction.toString().padStart(9, "0").replace(/0+$/, "");
  return fractionStr.length > 0
    ? `${whole.toString()}.${fractionStr} SOL`
    : `${whole.toString()} SOL`;
};

const lamportsBnFromSol = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Enter an amount in SOL");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Use a numeric SOL amount");
  }
  const [wholePart, decimalPart = ""] = trimmed.split(".");
  const safeDecimals = (decimalPart + "000000000").slice(0, 9);
  const lamports =
    BigInt(wholePart || "0") * LAMPORTS_PER_SOL_BIGINT +
    BigInt(safeDecimals || "0");
  if (lamports <= 0n) {
    throw new Error("Amount must be greater than zero");
  }
  return new BN(lamports.toString());
};

const convertInstruction = (ix: TransactionInstruction): Instruction => ({
  programAddress: address(ix.programId.toBase58()),
  accounts: ix.keys.map((meta) => ({
    address: address(meta.pubkey.toBase58()),
    role: meta.isSigner
      ? meta.isWritable
        ? AccountRole.WRITABLE_SIGNER
        : AccountRole.READONLY_SIGNER
      : meta.isWritable
        ? AccountRole.WRITABLE
        : AccountRole.READONLY,
  })),
  data: new Uint8Array(ix.data),
});

const extractError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong";
};

const buildInitialState = (): Record<number, PropertyState> =>
  Object.fromEntries(
    PROPERTIES.map((property) => [
      property.id,
      {
        vaultLamports: null,
        userAmount: null,
        withdrawn: null,
        loading: false,
      },
    ]),
  ) as Record<number, PropertyState>;

export default function HomePage() {
  const { rpc, chain, selectedAccount, isConnected } = useSolana();
  const [selectedPropertyId, setSelectedPropertyId] = useState(PROPERTIES[0].id);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [propertyStats, setPropertyStats] = useState<Record<number, PropertyState>>(
    buildInitialState,
  );

  const connection = useMemo(
    () => new Connection(RPC_ENDPOINT, { commitment: "confirmed" }),
    [],
  );

  const walletStub = useMemo<Wallet>(() => {
    const stubKeypair = Keypair.generate();
    return {
      publicKey: stubKeypair.publicKey,
      payer: stubKeypair,
      async signTransaction() {
        throw new Error("Wallet not available in read-only mode");
      },
      async signAllTransactions() {
        throw new Error("Wallet not available in read-only mode");
      },
    };
  }, []);

  const provider = useMemo(
    () => new AnchorProvider(connection, walletStub, { commitment: "confirmed" }),
    [connection, walletStub],
  );

  const program = useMemo(
    () => new Program<RealEstate>(REAL_ESTATE_IDL, provider),
    [provider],
  );

  const walletPublicKey = useMemo(() => {
    if (!selectedAccount) return null;
    try {
      return new PublicKey(selectedAccount.address);
    } catch (error) {
      console.error("Invalid wallet address", error);
      return null;
    }
  }, [selectedAccount]);

  const refreshProperty = useCallback(
    async (propertyId: number) => {
      setPropertyStats((prev) => ({
        ...prev,
        [propertyId]: { ...prev[propertyId], loading: true },
      }));
      try {
        const [vaultPda] = getVaultPda(propertyId);
        const lamports = await connection.getBalance(vaultPda);
        let userAmount: bigint | null = null;
        let withdrawn: boolean | null = null;

        if (walletPublicKey) {
          const [paymentPda] = getPaymentRecordPda(propertyId, walletPublicKey);
          const account = await program.account.paymentRecord.fetchNullable(
            paymentPda,
          );
          if (account) {
            userAmount = BigInt(account.amount.toString());
            withdrawn = account.withdrawn;
          } else {
            userAmount = 0n;
            withdrawn = null;
          }
        }

        setPropertyStats((prev) => ({
          ...prev,
          [propertyId]: {
            vaultLamports: BigInt(lamports),
            userAmount,
            withdrawn,
            loading: false,
          },
        }));
      } catch (error) {
        setFeedback({ variant: "error", message: extractError(error) });
        setPropertyStats((prev) => ({
          ...prev,
          [propertyId]: { ...prev[propertyId], loading: false },
        }));
      }
    },
    [connection, program, walletPublicKey],
  );

  useEffect(() => {
    PROPERTIES.forEach((property) => {
      void refreshProperty(property.id);
    });
  }, [refreshProperty]);

  const selectedStats = propertyStats[selectedPropertyId];
  const selectedProperty = PROPERTIES.find(
    (property) => property.id === selectedPropertyId,
  )!;

  const cardSummary = (propertyId: number): PropertySummary => {
    const stats = propertyStats[propertyId];
    return {
      vaultDisplay: formatLamports(stats?.vaultLamports ?? null),
      userDisplay: stats?.userAmount !== undefined
        ? formatLamports(stats.userAmount)
        : "—",
      loading: stats?.loading ?? false,
    };
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-400">
              Anchor powered vaults
            </p>
            <h1 className="text-3xl font-semibold text-white">
              Real Estate Launchpad
            </h1>
            <p className="text-sm text-slate-400">
              Program ID {PROGRAM_ID.toBase58()} on Solana Devnet
            </p>
          </div>
          <WalletConnectButton />
        </header>

        {feedback && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              feedback.variant === "success"
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-100"
                : feedback.variant === "error"
                  ? "border-rose-500/50 bg-rose-500/10 text-rose-100"
                  : "border-slate-700 bg-slate-900 text-slate-100"
            }`}
          >
            <p>{feedback.message}</p>
            {"signature" in feedback && feedback.signature && (
              <a
                href={`https://explorer.solana.com/tx/${feedback.signature}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex text-xs font-semibold text-white underline"
              >
                View transaction ↗
              </a>
            )}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          {PROPERTIES.map((property) => (
            <PropertyCard
              key={property.id}
              property={property}
              summary={cardSummary(property.id)}
              isSelected={property.id === selectedPropertyId}
              onSelect={() => {
                setSelectedPropertyId(property.id);
                void refreshProperty(property.id);
              }}
            />
          ))}
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Managing
            </p>
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-semibold text-white">
                {selectedProperty.name}
              </h2>
              <p className="text-sm text-slate-400">
                {selectedProperty.location} • {selectedProperty.highlight}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Vault balance
              </p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {formatLamports(selectedStats?.vaultLamports ?? null)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Your deposit
              </p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {formatLamports(selectedStats?.userAmount ?? null)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Withdrawn flag
              </p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {selectedStats?.withdrawn === null
                  ? "—"
                  : selectedStats.withdrawn
                    ? "true"
                    : "false"}
              </p>
            </div>
          </div>

          <div className="mt-6">
            {isConnected && selectedAccount && walletPublicKey ? (
              <PropertyActions
                account={selectedAccount}
                chain={chain}
                program={program}
                propertyId={selectedPropertyId}
                rpc={rpc}
                walletPublicKey={walletPublicKey}
                onFeedback={setFeedback}
                canWithdraw={Boolean(
                  selectedStats?.userAmount !== null &&
                    selectedStats?.userAmount !== undefined &&
                    selectedStats.userAmount > 0n,
                )}
                refresh={() => refreshProperty(selectedPropertyId)}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-sm text-slate-400">
                Connect a wallet to fund or withdraw from this property.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

type PropertyActionsProps = {
  account: UiWalletAccount;
  chain: string;
  program: Program<RealEstate>;
  propertyId: number;
  rpc: ReturnType<typeof useSolana>["rpc"];
  walletPublicKey: PublicKey;
  onFeedback: (state: FeedbackState) => void;
  canWithdraw: boolean;
  refresh: () => Promise<void>;
};

function PropertyActions({
  account,
  chain,
  program,
  propertyId,
  rpc,
  walletPublicKey,
  onFeedback,
  canWithdraw,
  refresh,
}: PropertyActionsProps) {
  const signer = useWalletAccountTransactionSendingSigner(account, "solana:");
  const [fundAmount, setFundAmount] = useState("0.50");
  const [withdrawAmount, setWithdrawAmount] = useState("0.10");
  const [pending, setPending] = useState<"fund" | "withdraw" | null>(null);

  const runAction = useCallback(
    async (
      kind: "fund" | "withdraw",
      builder: () => Promise<TransactionInstruction>,
    ) => {
      if (!signer) {
        onFeedback({ variant: "error", message: "Wallet signer unavailable" });
        return;
      }
      setPending(kind);
      onFeedback({
        variant: "info",
        message:
          kind === "fund"
            ? "Preparing funding transaction…"
            : "Preparing withdrawal…",
      });
      try {
        const instruction = await builder();
        const { value: latestBlockhash } = await rpc
          .getLatestBlockhash({ commitment: "confirmed" })
          .send();

        const message = pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayerSigner(signer, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
          (m) => appendTransactionMessageInstruction(
            convertInstruction(instruction),
            m,
          ),
        );

        const signatureBytes = await signAndSendTransactionMessageWithSigners(
          message,
        );
        const signature = getBase58Decoder().decode(signatureBytes) as Signature;
        onFeedback({
          variant: "success",
          message:
            kind === "fund"
              ? "Funding transaction submitted"
              : "Withdrawal transaction submitted",
          signature,
        });
        await refresh();
      } catch (error) {
        onFeedback({ variant: "error", message: extractError(error) });
      } finally {
        setPending(null);
      }
    },
    [onFeedback, rpc, signer, refresh],
  );

  const handleFund = () => {
    let amount: BN;
    try {
      amount = lamportsBnFromSol(fundAmount);
    } catch (error) {
      onFeedback({ variant: "error", message: extractError(error) });
      return;
    }
    void runAction("fund", () => {
      const [vaultPda] = getVaultPda(propertyId);
      const [paymentPda] = getPaymentRecordPda(propertyId, walletPublicKey);
      return program.methods
        .fundProperty(propertyId, amount)
        .accounts({
          payer: walletPublicKey
        })
        .instruction();
    });
  };

  const handleWithdraw = () => {
    let amount: BN;
    try {
      amount = lamportsBnFromSol(withdrawAmount);
    } catch (error) {
      onFeedback({ variant: "error", message: extractError(error) });
      return;
    }
    void runAction("withdraw", () => {
      const [vaultPda] = getVaultPda(propertyId);
      const [paymentPda] = getPaymentRecordPda(propertyId, walletPublicKey);
      return program.methods
        .withdrawMyPayment(propertyId, amount)
        .accounts({
          payer: walletPublicKey,
          paymentRecord: paymentPda,
          propertyVault: vaultPda,
        })
        .instruction();
    });
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-6">
        <h3 className="text-lg font-semibold text-white">Fund property</h3>
        <p className="text-sm text-slate-400">
          Creates/updates your payment record PDA and transfers SOL into the
          vault PDA.
        </p>
        <label className="mt-4 block text-sm font-medium text-slate-200">
          Amount (SOL)
          <input
            type="number"
            min="0"
            step="0.000000001"
            value={fundAmount}
            onChange={(event) => setFundAmount(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-base text-white focus:border-indigo-400 focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={handleFund}
          className="mt-4 w-full rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pending !== null}
        >
          {pending === "fund" ? "Funding…" : "Fund vault"}
        </button>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-6">
        <h3 className="text-lg font-semibold text-white">Withdraw deposit</h3>
        <p className="text-sm text-slate-400">
          Releases SOL from the vault PDA back to your connected wallet.
        </p>
        <label className="mt-4 block text-sm font-medium text-slate-200">
          Amount (SOL)
          <input
            type="number"
            min="0"
            step="0.000000001"
            value={withdrawAmount}
            onChange={(event) => setWithdrawAmount(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-base text-white focus:border-indigo-400 focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={handleWithdraw}
          className="mt-4 w-full rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-white hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pending !== null || !canWithdraw}
        >
          {pending === "withdraw" ? "Withdrawing…" : "Withdraw"}
        </button>
        {!canWithdraw && (
          <p className="mt-2 text-xs text-slate-400">
            Deposit first before withdrawing.
          </p>
        )}
      </div>
    </div>
  );
}
