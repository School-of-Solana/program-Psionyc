"use client";

import { cn } from "@/lib/utils";

export type PropertyMeta = {
  id: number;
  name: string;
  location: string;
  highlight: string;
  focus: string;
  tag: string;
  imageUrl: string;
};

export type PropertySummary = {
  vaultDisplay: string;
  userDisplay: string;
  loading: boolean;
};

interface PropertyCardProps {
  property: PropertyMeta;
  summary: PropertySummary;
  isSelected: boolean;
  onSelect: () => void;
}

export function PropertyCard({
  property,
  summary,
  isSelected,
  onSelect,
}: PropertyCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex flex-col gap-4 rounded-3xl border p-4 text-left transition",
        isSelected
          ? "border-indigo-400/80 bg-indigo-950/40 shadow-lg shadow-indigo-900/40"
          : "border-slate-800 bg-slate-900/40 hover:border-indigo-400/40 hover:bg-slate-900/60"
      )}
    >
      <div className="h-36 w-full overflow-hidden rounded-2xl bg-slate-900/30">
        <div
          className="h-full w-full bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
          style={{ backgroundImage: `url(${property.imageUrl})` }}
        />
      </div>
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-slate-400">
          {property.tag}
        </p>
        <div>
          <h3 className="text-xl font-semibold text-white">{property.name}</h3>
          <p className="text-sm text-slate-400">{property.location}</p>
        </div>
        <p className="text-sm text-slate-300">{property.highlight}</p>
        <p className="text-xs text-slate-500">{property.focus}</p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Vault balance
          </p>
          <p className="mt-1 font-semibold text-white">
            {summary.loading ? "…" : summary.vaultDisplay}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Your stake
          </p>
          <p className="mt-1 font-semibold text-white">
            {summary.loading ? "…" : summary.userDisplay}
          </p>
        </div>
      </div>
      <div className="text-xs font-semibold text-indigo-300">
        {isSelected ? "Selected" : "Click to manage"}
      </div>
    </button>
  );
}
