export class AlpenglowDetector {
  isAlpenglowActive(): boolean { return process.env.ALPENGLOW_FINALITY_ENABLED === 'true'; }
  getExpectedFinalityMs(): number { return this.isAlpenglowActive() ? 150 : 12800; }
}
