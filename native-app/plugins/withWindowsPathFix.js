const { withAppBuildGradle } = require("expo/config-plugins");

// ---------------------------------------------------------------------------
// Make the New Architecture's C++ codegen buildable on Windows.
//
// THE FAILURE. `./gradlew assembleRelease` dies in ninja with:
//
//   ninja: error: Stat(safeareacontext_autolinked_build/CMakeFiles/
//     react_codegen_safeareacontext.dir/C_/Users/.../RNCSafeAreaViewShadowNode.cpp.o):
//     Filename longer than 260 characters
//
// CMake names each object file by ENCODING THE FULL SOURCE PATH into it — the
// `C_/Users/...` segment above is a mangled copy of where the .cpp lives. With
// Fabric enabled, react-native-safe-area-context's shadow-node sources sit
// eleven directories deep inside node_modules, so the object path reaches ~371
// characters even before the build directory prefix.
//
// WHY LongPathsEnabled DOES NOT HELP. The registry flag is already 1 on this
// machine. It only affects callers that opt in via the Win32 manifest or the
// \\?\ prefix; ninja and CMake use the legacy path API and are still bound by
// MAX_PATH. Moving the checkout to C:\fp saves 51 characters and lands at 291
// — closer, and still over.
//
// THE FIX. CMAKE_OBJECT_PATH_MAX is CMake's own answer to exactly this. When an
// object path would exceed the limit, CMake substitutes a short hashed name
// instead of the encoded source path. It is a built-in variable, not a
// workaround, and it changes only where intermediate .o files are written —
// the compiled output, the ABIs and the shipped binary are identical.
//
// React Native's own NdkConfiguratorUtils adds its cmake arguments with
// `if (cmakeArgs.none { it.startsWith(...) })`, so an argument set here is
// respected rather than overwritten.
//
// This is a no-op on macOS and Linux, which have no such limit — but it is
// applied unconditionally so that a Windows developer and a CI worker produce
// byte-identical build inputs rather than diverging on host platform.
// ---------------------------------------------------------------------------

const MARKER = "withWindowsPathFix.js";

/** The block injected into android/app/build.gradle's `android {}`. */
const BLOCK = `
    // --- injected by plugins/${MARKER} ---
    // CMake encodes the full source path into every object filename, which
    // overruns Windows' 260-character MAX_PATH for the Fabric codegen sources
    // in node_modules. CMAKE_OBJECT_PATH_MAX makes CMake fall back to a short
    // hashed name for any object path that would exceed the limit. Affects
    // intermediate .o placement only — the shipped binary is unchanged.
    defaultConfig {
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_OBJECT_PATH_MAX=250"
            }
        }
    }
    // --- end injected ---
`;

module.exports = function withWindowsPathFix(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") {
      throw new Error(`${MARKER}: app/build.gradle is not Groovy; the CMake argument was not applied.`);
    }
    // Idempotent: prebuild runs this on every invocation, and a second copy of
    // the block would be a Gradle syntax error rather than a duplicate.
    if (cfg.modResults.contents.includes(MARKER)) return cfg;

    const anchor = cfg.modResults.contents.match(/android\s*\{/);
    if (!anchor) {
      throw new Error(`${MARKER}: could not find the \`android {\` block in app/build.gradle.`);
    }

    const at = anchor.index + anchor[0].length;
    cfg.modResults.contents =
      cfg.modResults.contents.slice(0, at) + BLOCK + cfg.modResults.contents.slice(at);
    return cfg;
  });
};
