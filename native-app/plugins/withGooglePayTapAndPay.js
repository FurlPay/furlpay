const { withAppBuildGradle } = require("expo/config-plugins");

const TAP_AND_PAY_DEPENDENCY =
  "implementation 'com.google.android.gms:play-services-tapandpay:18.4.1'";

/**
 * The pure gradle transform, exported so it can be unit tested.
 *
 * `withAppBuildGradle(config, action)` REGISTERS a mod and returns a config
 * object — it does not synchronously invoke `action`. A test therefore cannot
 * reach this logic through the plugin wrapper, which is why it is a named
 * export rather than an inline closure. The plugin's runtime behaviour is
 * unchanged; this is the same function it always ran.
 *
 * Idempotent by contract: Expo can apply a mod more than once across prebuilds,
 * and a duplicated `implementation` line makes gradle fail the build.
 */
function applyTapAndPayDependency(modResults) {
  if (modResults.language !== "groovy") return modResults;
  if (modResults.contents.includes(TAP_AND_PAY_DEPENDENCY)) return modResults;

  modResults.contents = modResults.contents.replace(
    /dependencies\s*{/,
    `dependencies {\n    ${TAP_AND_PAY_DEPENDENCY}`,
  );
  return modResults;
}

function withGooglePayTapAndPay(config) {
  return withAppBuildGradle(config, (cfg) => {
    applyTapAndPayDependency(cfg.modResults);
    return cfg;
  });
}

module.exports = withGooglePayTapAndPay;
module.exports.applyTapAndPayDependency = applyTapAndPayDependency;
module.exports.TAP_AND_PAY_DEPENDENCY = TAP_AND_PAY_DEPENDENCY;
