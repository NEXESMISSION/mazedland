/**
 * Shared legal copy — rendered on the standalone /terms and /privacy pages
 * AND inside the signup modal, so there's a single source of truth. Plain
 * presentational components (no client hooks) usable from server or client.
 *
 * This is general informational copy for the Batta.tn marketplace, not a
 * substitute for legal review before launch.
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
          Les présentes conditions générales régissent l&apos;utilisation de la
          plateforme Batta.tn, place de marché d&apos;enchères et de ventes
          immobilières en Tunisie. En créant un compte, vous acceptez ces
          conditions dans leur intégralité.
        </p>
      </Section>
      <Section title="2. Compte et vérification">
        <p>
          Vous devez fournir des informations exactes lors de l&apos;inscription.
          Une vérification d&apos;identité (KYC) est requise avant de pouvoir
          enchérir ou acheter. Vous êtes responsable de la confidentialité de
          vos identifiants.
        </p>
      </Section>
      <Section title="3. Enchères et achats">
        <p>
          Toute enchère constitue un engagement ferme. Une caution peut être
          exigée pour participer ; elle est remboursée si vous ne remportez pas
          l&apos;enchère, et peut être retenue en cas de non-respect de vos
          engagements. Le gagnant s&apos;engage à régler le solde dans les délais
          indiqués.
        </p>
      </Section>
      <Section title="4. Frais">
        <p>
          La publication d&apos;une annonce, les options de mise en avant et les
          commissions applicables sont affichées avant toute transaction. Les
          montants sont indiqués en dinars tunisiens (TND).
        </p>
      </Section>
      <Section title="5. Responsabilités">
        <p>
          Batta agit en tant qu&apos;intermédiaire. La conformité juridique des
          biens, l&apos;exactitude des informations fournies par les vendeurs et
          le bon déroulement des transactions relèvent de la responsabilité des
          parties. Nous recommandons une expertise indépendante avant
          d&apos;enchérir.
        </p>
      </Section>
      <Section title="6. Résiliation">
        <p>
          Nous pouvons suspendre ou clôturer un compte en cas de fraude,
          d&apos;abus ou de violation des présentes conditions.
        </p>
      </Section>
      <Section title="7. Modifications">
        <p>
          Ces conditions peuvent évoluer. La version en vigueur est celle
          publiée sur cette page.
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
          Nous collectons les informations que vous fournissez (nom, e-mail,
          téléphone, gouvernorat, pièces d&apos;identité pour la vérification)
          ainsi que les données d&apos;usage nécessaires au fonctionnement du
          service.
        </p>
      </Section>
      <Section title="2. Utilisation">
        <p>
          Vos données servent à créer et sécuriser votre compte, vérifier votre
          identité, traiter les enchères et paiements, et vous envoyer des
          notifications liées à votre activité.
        </p>
      </Section>
      <Section title="3. Partage">
        <p>
          Vos données ne sont pas vendues. Elles peuvent être partagées avec des
          prestataires strictement nécessaires (paiement, hébergement) et avec
          les autorités lorsque la loi l&apos;exige.
        </p>
      </Section>
      <Section title="4. Conservation et sécurité">
        <p>
          Les documents d&apos;identité sont stockés de manière sécurisée et
          accessibles uniquement aux fins de vérification. Nous appliquons des
          mesures techniques pour protéger vos données.
        </p>
      </Section>
      <Section title="5. Vos droits">
        <p>
          Vous pouvez demander l&apos;accès, la rectification ou la suppression
          de vos données en nous contactant à l&apos;adresse indiquée sur la
          page Contact.
        </p>
      </Section>
      <Section title="6. Cookies">
        <p>
          Nous utilisons des cookies essentiels au fonctionnement du site et,
          le cas échéant, des cookies de mesure d&apos;audience.
        </p>
      </Section>
    </div>
  );
}
