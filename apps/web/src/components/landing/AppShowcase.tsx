import StoreBadges from "@/components/marketing/StoreBadges";
import WalletCardTeaser from "./WalletCardTeaser";
import { editionLabel } from "@/components/card/edition";

/*
 * "Ship it, then carry it." The product surfaces a reader can actually touch:
 * where to get the apps, and the wallet card. Deliberately placed above the
 * rails marquee so the page moves from "here is the API" to "here is the
 * product" before it talks about partners.
 *
 * The phone capture that used to open this section now plays in the hero. It
 * is not repeated here: the same clip twice within one screen reads as a
 * mistake, and it is a 23MB download to make twice. So the wallet card — the
 * section's other real artefact — takes the visual column, and the copy takes
 * the text column, which is also the more conventional reading order.
 */
export default function AppShowcase() {
  return (
    <section className="section section-y-sm" aria-labelledby="app-showcase-title">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
        <div className="text-center lg:text-left">
          <p className="section-eyebrow">Apps</p>
          <h2 className="section-title mt-3" id="app-showcase-title">
            The same rails, in your pocket.
          </h2>
          {/* Future tense, because the present tense was a shipping claim.
              "Mobile, desktop and web share one account" describes a state
              that does not exist for a user today: only the web app is
              released. The architecture is real and the clients are built —
              that is worth saying — but "will" is the honest auxiliary until
              a listing goes live. */}
          <p className="section-lede mt-4">
            The web app is live today. Mobile and desktop clients are built and in final
            testing — when they ship they will share one account, one balance and one set of
            spending controls, on the same API surface your integration talks to.
          </p>

          {/* No justify-* here on purpose: StoreBadges centres itself
              (flex-col items-center, inner w-full justify-center), so an
              alignment class on this wrapper would be inert. Constraining the
              width is what actually places it against the copy on desktop. */}
          <div className="mt-8 lg:max-w-[380px]">
            <StoreBadges />
          </div>
        </div>

        {/* The card caps itself at 420px, so it is centred in its column rather
            than stretched to fill one. */}
        <div className="flex justify-center">
          <WalletCardTeaser initialEdition={editionLabel(new Date())} />
        </div>
      </div>
    </section>
  );
}
