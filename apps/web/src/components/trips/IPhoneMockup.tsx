import styles from "./trips.module.css";

/**
 * iPhone 15 Pro-proportioned device frame: titanium band, black bezel, inset
 * glass, side hardware and a specular sheen. Built from elements rather than a
 * device image so whatever is passed as `children` stays live HTML at 393x852
 * logical points — the same canvas the real app is laid out against.
 *
 * The frame is authored at 1x and scaled by `--s` (set per breakpoint in the
 * stylesheet), so the app inside never has to know how big it is being shown.
 */
export default function IPhoneMockup({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.phoneStage}>
      <div className={styles.phoneTilt}>
        <div className={styles.phoneSlot}>
          <div className={styles.phoneScale}>
            <div className={styles.frame}>
              {/* hardware */}
              <span className={styles.btnLeft} style={{ top: 148, height: 30 }} aria-hidden="true" />
              <span className={styles.btnLeft} style={{ top: 205, height: 58 }} aria-hidden="true" />
              <span className={styles.btnLeft} style={{ top: 278, height: 58 }} aria-hidden="true" />
              <span className={styles.btnRight} style={{ top: 250, height: 92 }} aria-hidden="true" />

              <div className={styles.bezel}>
                <div className={styles.screen}>
                  {children}
                  <span className={styles.glare} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
