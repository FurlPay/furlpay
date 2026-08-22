import styles from "./trips.module.css";

/** Section label above the Live Activity card. */
export default function LiveActivityBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(140,220,180,0.28)] bg-[rgba(6,32,22,0.5)] py-[7px] pl-[13px] pr-[15px]">
      <span className={`h-[7px] w-[7px] rounded-full bg-fp-bright ${styles.livePulse}`} />
      <span className="text-[13px] font-semibold uppercase tracking-[0.1em] text-fp-white">
        Live Activity
      </span>
    </span>
  );
}
