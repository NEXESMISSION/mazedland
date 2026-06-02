import { FileWarning } from "lucide-react";

export default function AdminFraud() {
  return (
    <div>
      <span className="batta-eyebrow">Cellule risques</span>
      <h2 className="mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight">
        Signaux de fraude
      </h2>
      <p className="mt-1 text-[12px] text-muted">
        La détection vit dans le moteur d&apos;enchères + la route de mise. Ce tableau de bord fera remonter :
      </p>
      <ul className="mt-5 space-y-2.5 rounded-xl bg-surface p-5 text-[12.5px] text-foreground/85 ring-1 ring-border">
        <Bullet>Soupçons d&apos;enchères fictives (même IP / empreinte d&apos;appareil que le vendeur)</Bullet>
        <Bullet>Nombre de rétractations de mise par enchérisseur</Bullet>
        <Bullet>Annonces signalées par les utilisateurs</Bullet>
        <Bullet>Tentatives de re-soumission KYC après rejet</Bullet>
        <Bullet>Seuils anti-blanchiment (LCB-FT) — alertes sur montants élevés</Bullet>
      </ul>
      <div className="batta-tone-warn mt-5 flex items-start gap-3 rounded-xl p-4 text-[12px]">
        <FileWarning className="size-4 shrink-0" strokeWidth={2.2} />
        <span>
          <strong className="font-extrabold uppercase tracking-[0.14em]">Feuille de route :</strong>{" "}
          livré après les 100 premières vraies mises — plus simple de calibrer les détecteurs
          sur du signal réel que sur des données synthétiques.
        </span>
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-gold" />
      <span>{children}</span>
    </li>
  );
}
