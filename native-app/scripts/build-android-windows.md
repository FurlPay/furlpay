# Building the Android release on Windows

`./gradlew assembleRelease` fails on this repository from its normal checkout
location. This is not a configuration problem — it is Windows' 260-character
`MAX_PATH`, and the fix is mechanical.

## The failure

```
ninja: error: Stat(safeareacontext_autolinked_build/CMakeFiles/
  react_codegen_safeareacontext.dir/C_/Users/ashut/OneDrive/Documents/
  Payment_App/native-app/node_modules/react-native-safe-area-context/common/
  cpp/react/renderer/components/safeareacontext/RNCSafeAreaViewShadowNode.cpp.o):
  Filename longer than 260 characters
```

It appears **after roughly 90 minutes** of successful compilation, at the
`buildCMakeRelWithDebInfo` step, so it is expensive to discover.

## Why it happens

CMake names each object file by encoding the **full source path** into it — the
`C_/Users/...` segment above is a mangled copy of where the `.cpp` lives. Three
things compound:

| Component | Length |
| --- | --- |
| Build directory (`android/app/.cxx/RelWithDebInfo/<hash>/arm64-v8a/...`) | ~117 |
| Encoded source path from a normal checkout | ~185 |
| **Total** | **~371** |

React Native's New Architecture (Fabric) generates C++ shadow-node sources for
every view library, and `react-native-safe-area-context` puts them eleven
directories deep inside `node_modules`. Nothing in this repository controls
either depth.

## What does NOT fix it

- **`LongPathsEnabled=1`.** Already set on the development machine. It only
  helps callers that opt in through the Win32 manifest or the `\\?\` prefix;
  ninja and CMake use the legacy path API and remain bound by `MAX_PATH`.
- **A junction to a short path.** Gradle resolves reparse points to their real
  target before handing paths to CMake, so `C:\fp → C:\Users\...` buys nothing.
- **`CMAKE_OBJECT_PATH_MAX` alone.** `plugins/withWindowsPathFix.js` sets it
  (and it is correct to keep), but CMake 3.22 — the version bundled with the
  Android SDK — does not apply the hashed-name fallback to these generated
  codegen targets.

## What does fix it

Build from a genuinely short **real** path. A checkout at `C:\b` brings the
same object path to **241 characters**, under the limit:

```powershell
# One-time: create a short build tree
robocopy "C:\Users\<you>\...\native-app" C:\b /E /XD node_modules android ios .expo .git
robocopy "C:\Users\<you>\...\native-app\node_modules" C:\b\node_modules /E /MT:16
```

Then build there:

```bash
cd /c/b
npx expo prebuild --platform android --no-install
cd android
export JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.9.10-hotspot"
export ANDROID_HOME="/c/Android/sdk"
./gradlew assembleRelease --no-daemon
```

`node_modules` must be **copied, not linked** — a junction is resolved back to
the long path and the build fails identically.

## Verifying the fix took effect

The files that fail are `safeareacontext`'s shadow nodes. Once they compile, the
limit is cleared:

```bash
find /c/b/android/app/.cxx -path "*safeareacontext*" -name "*.o" | wc -l   # > 0
find /c/b/android/app/.cxx -name "*.o" | awk '{print length($0)}' | sort -rn | head -1   # < 260
```

## None of this affects macOS, Linux, or EAS

They have no such path limit. `eas build --platform android` builds on Linux
workers from the normal checkout and needs none of the above. This document
exists only for local Windows release builds.
