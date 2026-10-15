# Third-party components

The MIT license in this repository applies to Gravity Code's original interface,
controller, adapter and build scripts. It does not relicense other products.

The Windows archive includes Electron 43.7.11 and its dependencies under their
respective licenses. See LICENSE and LICENSES.chromium.html in the archive.
Electron: https://github.com/electron/electron

Claude Code 2.1.270 is a separate Anthropic product. The app downloads the
unmodified Windows engine directly from Anthropic on user request, verifies its
pinned SHA-256, and runs it as a separate process. This repository and release
do not distribute Claude Desktop, Claude Code, extracted vendor source, vendor
assets, or the Anthropic Agent SDK. Use of that engine remains subject to its
own applicable terms: https://code.claude.com/docs/en/legal-and-compliance

The Gemini website and Google account services belong to Google. This app is
an independent experiment, unaffiliated with Google or Anthropic. Website
protocol compatibility and account availability are not guaranteed.

REA was used for private static analysis, not included in the runtime:
https://github.com/morluto/rea
