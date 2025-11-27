"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import type { Wallet as AnchorWalletInterface } from "@coral-xyz/anchor";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { REAL_ESTATE_IDL, type RealEstate } from "../../real_estate";

const PROGRAM_ID = new PublicKey(REAL_ESTATE_IDL.address);
const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com";
const MASTER_AUTHORITY = "6KrYBHTXzJjn78L4aJGpocQwiJEoV1yqu6HNqgFixEYE";
const PAYMENT_SEED = new TextEncoder().encode("payment");
const VAULT_SEED = new TextEncoder().encode("property_vault");
const LAMPORTS_PER_SOL_BIGINT = BigInt(LAMPORTS_PER_SOL);

const shorten = (value: string) => `${value.slice(0, 4)}…${value.slice(-4)}`;

const propertySeed = (propertyId: number) => {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, propertyId, true);
  return new Uint8Array(buffer);
};

const getVaultPda = (propertyId: number) =>
  PublicKey.findProgramAddressSync(
    [VAULT_SEED, propertySeed(propertyId)],
    PROGRAM_ID,
  );

const getPaymentRecordPda = (propertyId: number, payer: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [PAYMENT_SEED, propertySeed(propertyId), payer.toBytes()],
    PROGRAM_ID,
  );

type PhantomEvent = "connect" | "disconnect" | "accountChanged";

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey: PublicKey | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey }>;
  disconnect: () => Promise<void>;
  on: (event: PhantomEvent, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: PhantomEvent, handler: (...args: unknown[]) => void) => void;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
}

declare global {
  interface Window {
    solana?: PhantomProvider;
  }
}

type FeedbackState =
  | { variant: "success"; message: string; signature?: string }
  | { variant: "error"; message: string }
  | { variant: "info"; message: string };

type PaymentRecordView = {
  amount: bigint;
  withdrawn: boolean;
  propertyId: number;
};

const formatLamports = (lamports: bigint | null) => {
  if (lamports === null) return "—";
  const whole = lamports / LAMPORTS_PER_SOL_BIGINT;
  const fraction = lamports % LAMPORTS_PER_SOL_BIGINT;
  const fractionStr = fraction.toString().padStart(9, "0").replace(/0+$/, "");
  return fractionStr.length > 0
    ? `${whole.toString()}.${fractionStr}`
    : whole.toString();
};

const lamportsBnFromSol = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Enter an amount in SOL");
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Please use a numeric SOL amount");
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

const extractError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong";
};

export default function HomePage() {
  const [phantom, setPhantom] = useState<PhantomProvider | null>(null);
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [propertyIdInput, setPropertyIdInput] = useState("1");
  const [fundAmount, setFundAmount] = useState("0.5");
  const [withdrawAmount, setWithdrawAmount] = useState("0.1");
  const [masterAmount, setMasterAmount] = useState("0.1");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [vaultLamports, setVaultLamports] = useState<bigint | null>(null);
  const [paymentRecord, setPaymentRecord] = useState<PaymentRecordView | null>(null);
  const [connecting, setConnecting] = useState(false);

  const parsedPropertyId = useMemo(() => {
    if (propertyIdInput.trim() === "") return null;
    const parsed = Number(propertyIdInput);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
      return null;
    }
    return parsed;
  }, [propertyIdInput]);

  const connection = useMemo(
    () => new Connection(RPC_ENDPOINT, { commitment: "confirmed" }),
    [],
  );

  const anchorWallet = useMemo<AnchorWalletInterface | null>(() => {
    if (!phantom || !publicKey) return null;
    return {
      publicKey,
      signTransaction: phantom.signTransaction.bind(phantom),
      signAllTransactions: phantom.signAllTransactions.bind(phantom),
    } satisfies Wallet;
  }, [phantom, publicKey]);

  const provider = useMemo(() => {
    if (!anchorWallet) return null;
    return new AnchorProvider(connection, anchorWallet, {
      commitment: "confirmed",
    });
  }, [anchorWallet, connection]);

  const program = useMemo(() => {
    if (!provider) return null;
    return new Program<RealEstate>(REAL_ESTATE_IDL, PROGRAM_ID, provider);
  }, [provider]);

  const refreshAccounts = useCallback(async () => {
    if (parsedPropertyId === null) {
      setVaultLamports(null);
      setPaymentRecord(null);
      setAccountLoading(false);
      return;
    }
    setAccountLoading(true);
    try {
      const [vaultPda] = getVaultPda(parsedPropertyId);
      const lamports = await connection.getBalance(vaultPda);
      setVaultLamports(BigInt(lamports));
      if (program && publicKey) {
        const [paymentPda] = getPaymentRecordPda(parsedPropertyId, publicKey);
        const account = await program.account.paymentRecord.fetchNullable(paymentPda);
        if (account) {
          setPaymentRecord({
            amount: BigInt(account.amount.toString()),
            withdrawn: account.withdrawn,
            propertyId: account.propertyId,
          });
        } else {
          setPaymentRecord(null);
        }
      } else if (!publicKey) {
        setPaymentRecord(null);
      }
    } catch (error) {
      setFeedback({ variant: "error", message: extractError(error) });
    } finally {
      setAccountLoading(false);
    }
  }, [connection, parsedPropertyId, program, publicKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const provider = window.solana;
    if (!provider || !provider.isPhantom) {
      setPhantom(null);
      return;
    }
    setPhantom(provider);

    const setKey = (key: PublicKey | string | null | undefined) => {
      if (!key) {
        setPublicKey(null);
        return;
      }
      try {
        setPublicKey(typeof key === "string" ? new PublicKey(key) : key);
      } catch (error) {
        console.error("Failed to parse public key", error);
      }
    };

    const handleConnect = () => setKey(provider.publicKey);
    const handleDisconnect = () => setPublicKey(null);
    const handleAccountChange = (key: PublicKey | string | null) => setKey(key);

    provider.on("connect", handleConnect);
    provider.on("disconnect", handleDisconnect);
    provider.on("accountChanged", handleAccountChange);

    if (provider.publicKey) {
      setKey(provider.publicKey);
    }

    provider.connect({ onlyIfTrusted: true }).catch(() => undefined);

    return () => {
      provider.removeListener?.("connect", handleConnect);
      provider.removeListener?.("disconnect", handleDisconnect);
      provider.removeListener?.("accountChanged", handleAccountChange);
    };
  }, []);

  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  const requireWallet = () => {
    if (!phantom) {
      setFeedback({ variant: "error", message: "Install Phantom to continue" });
      return false;
    }
    if (!publicKey) {
      setFeedback({ variant: "error", message: "Connect your wallet first" });
      return false;
    }
    if (parsedPropertyId === null) {
      setFeedback({ variant: "error", message: "Enter a valid property ID" });
      return false;
    }
    if (!program) {
      setFeedback({ variant: "error", message: "Anchor provider not ready" });
      return false;
    }
    return true;
  };

  const runAction = async (
    label: string,
    handler: () => Promise<string>,
  ) => {
    setPendingAction(label);
    setFeedback({ variant: "info", message: `${label} in progress…` });
    try {
      const signature = await handler();
      setFeedback({
        variant: "success",
        message: `${label} submitted`,
        signature,
      });
      await refreshAccounts();
    } catch (error) {
      setFeedback({ variant: "error", message: extractError(error) });
    } finally {
      setPendingAction(null);
    }
  };

const handleFund = async () => {
    if (
      !requireWallet() ||
      parsedPropertyId === null ||
      !program ||
      !publicKey
    ) {
      return;
    }
    let amount: BN;
    try {
      amount = lamportsBnFromSol(fundAmount);
    } catch (error) {
      setFeedback({ variant: "error", message: extractError(error) });
      return;
    }
    const [vaultPda] = getVaultPda(parsedPropertyId);
    const [paymentPda] = getPaymentRecordPda(parsedPropertyId, publicKey);
    await runAction("Funding property", () =>
      program.methods
        .fundProperty(parsedPropertyId, amount)
        .accounts({
          payer: publicKey,
          propertyVault: vaultPda,
          paymentRecord: paymentPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    );
  };

const handleWithdraw = async () => {
    if (
      !requireWallet() ||
      parsedPropertyId === null ||
      !program ||
      !publicKey
    ) {
      return;
    }
    let amount: BN;
    try {
      amount = lamportsBnFromSol(withdrawAmount);
    } catch (error) {
      setFeedback({ variant: "error", message: extractError(error) });
      return;
    }
    const [vaultPda] = getVaultPda(parsedPropertyId);
    const [paymentPda] = getPaymentRecordPda(parsedPropertyId, publicKey);
    await runAction("Withdrawing deposit", () =>
      program.methods
        .withdrawMyPayment(parsedPropertyId, amount)
        .accounts({
          payer: publicKey,
          paymentRecord: paymentPda,
          propertyVault: vaultPda,
        })
        .rpc(),
    );
  };

const handleMasterWithdraw = async () => {
    if (
      !requireWallet() ||
      parsedPropertyId === null ||
      !program ||
      !publicKey
    ) {
      return;
    }
    let amount: BN;
    try {
      amount = lamportsBnFromSol(masterAmount);
    } catch (error) {
      setFeedback({ variant: "error", message: extractError(error) });
      return;
    }
    const [vaultPda] = getVaultPda(parsedPropertyId);
    await runAction("Master withdraw", () =>
      program.methods
        .withdrawMaster(parsedPropertyId, amount)
        .accounts({
          master: publicKey,
          propertyVault: vaultPda,
        })
        .rpc(),
    );
  };

  const handleConnect = async () => {
    if (!phantom) {
      setFeedback({ variant: "error", message: "Install Phantom to connect" });
      return;
    }
    setConnecting(true);
    try {
      const response = await phantom.connect();
      setPublicKey(response.publicKey);
      setFeedback({ variant: "success", message: "Wallet connected" });
    } catch (error) {
      setFeedback({ variant: "error", message: extractError(error) });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!phantom) return;
    await phantom.disconnect();
    setPublicKey(null);
    setPaymentRecord(null);
  };

  const explorerUrl = (signature: string) =>
    `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

  const propertyIdError =
    propertyIdInput.trim() !== "" && parsedPropertyId === null
      ? "Property ID must be a 32-bit unsigned integer"
      : null;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-50">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl shadow-black/30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-wide text-slate-400">
                Anchor Program
              </p>
              <h1 className="text-3xl font-semibold text-white">
                Real Estate Vaults
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Program ID {shorten(PROGRAM_ID.toBase58())} on Devnet ({RPC_ENDPOINT})
              </p>
            </div>
            <div className="flex items-center gap-3">
              {publicKey ? (
                <>
                  <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-mono text-emerald-300">
                    {shorten(publicKey.toBase58())}
                  </span>
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-white hover:border-slate-500"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleConnect}
                  className="rounded-full bg-indigo-500 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!phantom || connecting}
                >
                  {phantom ? (connecting ? "Connecting…" : "Connect Phantom") : "Install Phantom"}
                </button>
              )}
            </div>
          </div>
          {!phantom && (
            <p className="mt-4 text-sm text-amber-400">
              Phantom wallet not detected. Install it from {" "}
              <a
                href="https://phantom.app/download"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                phantom.app/download
              </a>
              .
            </p>
          )}
        </section>

        {feedback && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              feedback.variant === "success"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                : feedback.variant === "error"
                  ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
                  : "border-slate-600 bg-slate-800 text-slate-200"
            }`}
          >
            <p>{feedback.message}</p>
            {"signature" in feedback && feedback.signature && (
              <a
                href={explorerUrl(feedback.signature)}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex text-xs font-semibold text-white underline"
              >
                View on Solana Explorer
              </a>
            )}
          </div>
        )}

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex-1 text-sm font-medium text-slate-200">
              Property ID
              <input
                type="number"
                min={0}
                max={0xffffffff}
                value={propertyIdInput}
                onChange={(event) => setPropertyIdInput(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-base text-white focus:border-indigo-400 focus:outline-none"
                placeholder="e.g. 1"
              />
            </label>
            <button
              type="button"
              onClick={refreshAccounts}
              className="h-10 rounded-lg border border-slate-700 px-4 text-sm font-semibold text-white hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={parsedPropertyId === null || accountLoading}
            >
              {accountLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {propertyIdError && (
            <p className="mt-2 text-xs text-rose-300">{propertyIdError}</p>
          )}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Vault balance</p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {vaultLamports !== null ? `${formatLamports(vaultLamports)} SOL` : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Your deposit</p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {paymentRecord ? `${formatLamports(paymentRecord.amount)} SOL` : "—"}
              </p>
              {paymentRecord && (
                <p className="text-xs text-slate-400">
                  Withdrawn flag: {paymentRecord.withdrawn ? "true" : "false"}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-lg font-semibold text-white">Fund property</h2>
            <p className="text-sm text-slate-400">
              Moves SOL from your wallet into the selected property vault PDA.
            </p>
            <label className="mt-4 block text-sm font-medium text-slate-200">
              Amount (SOL)
              <input
                type="number"
                min="0"
                step="0.000000001"
                value={fundAmount}
                onChange={(event) => setFundAmount(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-base text-white focus:border-indigo-400 focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={handleFund}
              className="mt-4 w-full rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pendingAction !== null}
            >
              {pendingAction === "Funding property" ? "Funding…" : "Fund"}
            </button>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-white">Withdraw my deposit</h2>
              <p className="text-sm text-slate-400">
                Uses the payment record PDA tied to your wallet.
              </p>
              <label className="mt-4 block text-sm font-medium text-slate-200">
                Amount (SOL)
                <input
                  type="number"
                  min="0"
                  step="0.000000001"
                  value={withdrawAmount}
                  onChange={(event) => setWithdrawAmount(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-base text-white focus:border-indigo-400 focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={handleWithdraw}
                className="mt-4 w-full rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-white hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={pendingAction !== null || !paymentRecord}
              >
                {pendingAction === "Withdrawing deposit" ? "Withdrawing…" : "Withdraw"}
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <h3 className="text-base font-semibold text-white">Master withdraw</h3>
              <p className="text-xs text-slate-400">
                Only the Squads multisig ({shorten(MASTER_AUTHORITY)}) can succeed.
              </p>
              <label className="mt-3 block text-xs font-medium text-slate-200">
                Amount (SOL)
                <input
                  type="number"
                  min="0"
                  step="0.000000001"
                  value={masterAmount}
                  onChange={(event) => setMasterAmount(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-base text-white focus:border-indigo-400 focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={handleMasterWithdraw}
                className="mt-3 w-full rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={pendingAction !== null}
              >
                {pendingAction === "Master withdraw" ? "Executing…" : "Withdraw as master"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
