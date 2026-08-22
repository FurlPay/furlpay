import FurlPayLogo from "./FurlPayLogo";

/**
 * Brand lockup + hero statement. Sizes are fluid so the three-line break
 * ("Your entire / journey is alive / on your iPhone.") survives from the 384px
 * reference column down to a phone, which is the whole point of the type scale
 * here — the line breaks are the composition.
 */
export default function HeroHeadline() {
  return (
    <div>
      <FurlPayLogo size={38} markSize={55} className="mb-[53px] max-sm:mb-8" />

      <h1 className="text-[clamp(38px,4.9vw,55px)] font-normal leading-[1.06] tracking-[-0.022em] text-fp-white">
        Your entire
        <br />
        <span className="text-fp-dim">journey is alive</span>
        <br />
        on your iPhone.
      </h1>

      <p className="mt-[24px] text-[clamp(21px,2.6vw,29px)] font-medium leading-none tracking-[-0.015em] text-fp-white">
        Powered by <span className="text-fp-dim">FurlPay</span>.
      </p>
    </div>
  );
}
