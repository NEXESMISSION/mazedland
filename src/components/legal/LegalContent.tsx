/**
 * Shared legal copy — rendered on the standalone /terms and /privacy pages AND
 * inside the signup modal, so there is a single source of truth. Plain
 * presentational components (no client hooks) usable from server or client.
 *
 * WHAT CHANGED. These described an auction house: KYC before bidding, bids as
 * firm commitments, cautions that could be forfeited, identity documents held
 * for verification. None of that exists. Terms that describe a service the
 * user is not getting are not merely stale — they are the document a dispute
 * would be settled against. They now describe the classifieds service as it
 * actually runs.
 *
 * General informational copy, not a substitute for legal review before launch.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
      <div className="mt-1.5 space-y-2 text-[13.5px] leading-relaxed text-foreground/80">
        {children}
      </div>
    </section>
  );
}

export function TermsContent() {
  return (
    <div>
      <Section title="1. Objet">
        <p>
          Les présentes conditions générales régissent l&apos;utilisation de Mazed
          Immo, plateforme de petites annonces immobilières en Tunisie : terrains,
          maisons, appartements, villas, bureaux et locaux. En créant un compte,
          vous acceptez ces conditions dans leur intégralité.
        </p>
      </Section>
      <Section title="2. Compte">
        <p>
          Vous devez fournir des informations exactes lors de l&apos;inscription,
          notamment un numéro de téléphone que vous contrôlez. Vous êtes
          responsable de la confidentialité de vos identifiants et de toute
          activité réalisée depuis votre compte.
        </p>
      </Section>
      <Section title="3. Annonces">
        <p>
          Le vendeur garantit qu&apos;il est habilité à proposer le bien et que
          les informations, le prix et les photos publiés sont exacts. Chaque
          annonce est vérifiée par notre équipe avant publication. Mazed Immo peut
          refuser, suspendre ou retirer une annonce trompeuse, illicite ou
          contraire aux présentes conditions.
        </p>
      </Section>
      <Section title="4. Frais">
        <p>
          Les frais de publication et les options de mise en avant sont affichés
          avant tout paiement, en dinars tunisiens (TND). Le paiement se fait par
          virement bancaire ou D17, sur justificatif vérifié par notre équipe. Les
          frais déjà réglés restent acquis si une annonce est retirée pour
          non-respect des présentes conditions.
        </p>
      </Section>
      <Section title="5. Mise en relation">
        <p>
          Mazed Immo met en relation acheteurs et vendeurs et n&apos;intervient pas
          dans la transaction : la négociation, le paiement du prix et la
          signature se font directement entre les parties. Le numéro du vendeur
          est communiqué sur demande. Avant tout versement, visitez le bien,
          demandez le titre de propriété et faites appel à un notaire.
        </p>
      </Section>
      <Section title="6. Responsabilité">
        <p>
          La situation juridique du bien, l&apos;exactitude des informations
          fournies par le vendeur et le bon déroulement de la vente relèvent de la
          responsabilité des parties. Mazed Immo ne peut être tenu responsable
          d&apos;un litige entre elles.
        </p>
      </Section>
      <Section title="7. Suspension et résiliation">
        <p>
          Nous pouvons suspendre ou clôturer un compte en cas de fraude,
          d&apos;abus ou de violation des présentes conditions. Vous pouvez
          supprimer votre compte à tout moment depuis la page Mon compte.
        </p>
      </Section>
      <Section title="8. Modifications">
        <p>
          Ces conditions peuvent évoluer. La version en vigueur est celle publiée
          sur cette page.
        </p>
      </Section>
    </div>
  );
}

export function PrivacyContent() {
  return (
    <div>
      <Section title="1. Données collectées">
        <p>
          Nous collectons les informations que vous fournissez — nom, numéro de
          téléphone, gouvernorat, contenu et photos de vos annonces, justificatifs
          de paiement — ainsi que les données d&apos;usage nécessaires au
          fonctionnement et à la sécurité du service.
        </p>
      </Section>
      <Section title="2. Utilisation">
        <p>
          Vos données servent à créer et sécuriser votre compte, vérifier et
          publier vos annonces, traiter vos paiements et vous envoyer les
          notifications liées à votre activité.
        </p>
      </Section>
      <Section title="3. Votre numéro de téléphone">
        <p>
          Le numéro associé à une annonce n&apos;est jamais affiché dans la page.
          Il est communiqué uniquement à la personne qui le demande, et chaque
          demande est enregistrée et limitée afin d&apos;empêcher la collecte
          automatisée.
        </p>
      </Section>
      <Section title="4. Partage">
        <p>
          Vos données ne sont pas vendues. Elles peuvent être partagées avec des
          prestataires strictement nécessaires (hébergement, envoi de SMS et
          d&apos;e-mails) et avec les autorités lorsque la loi l&apos;exige.
        </p>
      </Section>
      <Section title="5. Conservation et sécurité">
        <p>
          Les justificatifs de paiement sont stockés dans un espace privé,
          accessible uniquement à notre équipe pour leur vérification. Nous
          appliquons des mesures techniques et organisationnelles pour protéger
          vos données et ne les conservons que le temps nécessaire.
        </p>
      </Section>
      <Section title="6. Vos droits">
        <p>
          Vous pouvez demander l&apos;accès, la rectification ou la suppression
          de vos données, ou supprimer votre compte depuis la page Mon compte.
          Pour toute question, écrivez-nous via la page Contact.
        </p>
      </Section>
      <Section title="7. Cookies">
        <p>
          Nous utilisons des cookies essentiels au fonctionnement du site
          (session, préférences) et une mesure d&apos;audience anonyme.
        </p>
      </Section>
    </div>
  );
}
