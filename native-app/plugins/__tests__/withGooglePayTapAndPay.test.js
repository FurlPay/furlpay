const {
  applyTapAndPayDependency,
  TAP_AND_PAY_DEPENDENCY,
} = require("../withGooglePayTapAndPay");

// The plugin's gradle transform.
//
// Tested through `applyTapAndPayDependency` rather than through the plugin
// wrapper: `withAppBuildGradle(config, action)` REGISTERS a mod with Expo and
// returns a config object — it never synchronously calls `action`, so the
// transform is unreachable from outside. The original test called the returned
// config as if it were a function, which is why it failed.
//
// The intent under test is unchanged: the dependency is added exactly once, and
// applying the transform twice does not duplicate it. A duplicated
// `implementation` line makes the Android build fail, and Expo can apply a mod
// more than once across prebuilds.

describe("withGooglePayTapAndPay", () => {
  it("adds the TapAndPay dependency to the app build.gradle", () => {
    const modResults = {
      language: "groovy",
      contents: "dependencies {\n    implementation 'something:else:1.0.0'\n}",
    };

    const result = applyTapAndPayDependency(modResults);
    expect(result.contents).toContain(TAP_AND_PAY_DEPENDENCY);
    // The pre-existing dependency survives.
    expect(result.contents).toContain("implementation 'something:else:1.0.0'");
  });

  it("does not add the dependency if it already exists", () => {
    const modResults = {
      language: "groovy",
      contents: `dependencies {\n    ${TAP_AND_PAY_DEPENDENCY}\n}`,
    };

    const result = applyTapAndPayDependency(modResults);
    const matches = result.contents.match(/play-services-tapandpay:18\.4\.1/g);
    expect(matches).toHaveLength(1);
  });

  it("is idempotent across repeated application", () => {
    const modResults = {
      language: "groovy",
      contents: "dependencies {\n}",
    };

    applyTapAndPayDependency(modResults);
    applyTapAndPayDependency(modResults);
    applyTapAndPayDependency(modResults);

    expect(modResults.contents.match(/play-services-tapandpay:18\.4\.1/g)).toHaveLength(1);
  });

  it("leaves a non-groovy (kotlin DSL) build file untouched", () => {
    const modResults = {
      language: "kt",
      contents: "dependencies {\n}",
    };

    const result = applyTapAndPayDependency(modResults);
    expect(result.contents).not.toContain(TAP_AND_PAY_DEPENDENCY);
  });
});
