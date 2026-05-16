"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";

const GOVS = [
  "Tunis", "Ariana", "Ben Arous", "Manouba",
  "Sousse", "Monastir", "Mahdia", "Nabeul",
  "Sfax", "Bizerte", "Gabès", "Médenine",
  "Kairouan", "Béja", "Jendouba", "Kef",
  "Kasserine", "Sidi Bouzid", "Gafsa", "Tozeur",
  "Kebili", "Tataouine", "Siliana", "Zaghouan",
];

const SPECIALITIES = [
  { value: "architect", label: "Architect" },
  { value: "civil_engineer", label: "Civil engineer" },
  { value: "real_estate_expert", label: "Real-estate expert" },
  { value: "property_lawyer", label: "Property lawyer" },
];

export function InspectorApplyForm() {
  const router = useRouter();
  const [speciality, setSpeciality] = useState("architect");
  const [govs, setGovs] = useState<string[]>([]);
  const [bio, setBio] = useState("");
  const [diploma, setDiploma] = useState<File | null>(null);
  const [insurance, setInsurance] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleGov(g: string) {
    setGovs((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (govs.length === 0) {
      setError("Pick at least one governorate.");
      return;
    }
    if (!diploma) {
      setError("Diploma upload is required.");
      return;
    }
    startTransition(async () => {
      const supabase = getBrowserSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in.");
        return;
      }
      try {
        const ext = diploma.name.split(".").pop()?.toLowerCase() || "pdf";
        const diplomaPath = `${user.id}/diploma-${Date.now()}.${ext}`;
        const { error: dErr } = await supabase.storage.from("inspector-credentials").upload(diplomaPath, diploma);
        if (dErr) throw new Error(dErr.message);

        let insurancePath: string | null = null;
        if (insurance) {
          const iext = insurance.name.split(".").pop()?.toLowerCase() || "pdf";
          insurancePath = `${user.id}/insurance-${Date.now()}.${iext}`;
          const { error: iErr } = await supabase.storage.from("inspector-credentials").upload(insurancePath, insurance);
          if (iErr) throw new Error(iErr.message);
        }

        const { error: insertErr } = await supabase.from("inspectors").upsert({
          id: user.id,
          speciality,
          governorates: govs,
          bio,
          diploma_path: diplomaPath,
          insurance_path: insurancePath,
        });
        if (insertErr) throw new Error(insertErr.message);

        // Role elevation to 'inspector' happens server-side when an admin
        // approves the application via /admin/inspectors. Self-promoting
        // here would be vetoed by the profile-update guard trigger anyway.

        router.replace("/account");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Submit failed");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <label className="block">
        <span className="text-xs font-medium text-batta-muted">Speciality</span>
        <select
          value={speciality}
          onChange={(e) => setSpeciality(e.target.value)}
          className="mt-1 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-2.5 text-sm text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
        >
          {SPECIALITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>

      <div>
        <span className="text-xs font-medium text-batta-muted">Governorates I cover</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {GOVS.map((g) => {
            const active = govs.includes(g);
            return (
              <button
                key={g}
                type="button"
                onClick={() => toggleGov(g)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  active
                    ? "border-batta-gold bg-batta-navy text-batta-gold-bright ring-1 ring-batta-gold/40"
                    : "border-batta-gold/20 bg-batta-surface-2 text-batta-cream/70 hover:border-batta-gold/50"
                }`}
              >
                {g}
              </button>
            );
          })}
        </div>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-batta-muted">Short bio</span>
        <textarea
          rows={4}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          className="mt-1 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-2.5 text-sm text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
        />
      </label>

      <Picker label="Diploma (PDF)" file={diploma} onChange={setDiploma} required accept=".pdf,image/*" />
      <Picker label="Professional liability insurance" file={insurance} onChange={setInsurance} accept=".pdf,image/*" />

      {error && <p className="batta-tone-bad rounded-lg px-3 py-2 text-xs">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="batta-btn-luxe tap-target w-full px-5 py-3 text-[13.5px] disabled:opacity-50"
      >
        {isPending ? "…" : "Submit application"}
      </button>
    </form>
  );
}

function Picker({
  label, file, onChange, accept, required,
}: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
  accept: string;
  required?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-batta-gold/30 bg-batta-surface-2 p-4">
      <div className="flex-1">
        <div className="text-sm font-medium text-batta-cream">{label}{required && " *"}</div>
        <div className="text-xs text-batta-muted">
          {file ? `📎 ${file.name}` : "Tap to upload"}
        </div>
      </div>
      <input
        type="file"
        accept={accept}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="hidden"
      />
    </label>
  );
}
