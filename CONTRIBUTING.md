# Contributing to Deeptask

Thanks for taking the time to contribute.

This repository snapshot is the Deeptask-branded 5.5.0 source baseline. Keep changes focused on the Deeptask package and avoid reintroducing upstream branding into user-facing files, images, badges, screenshots, marketplace metadata, or VSIX assets.

## Before You Start

- Confirm that `src/package.json` still identifies the extension as `deeptask` version `5.5.0`.
- Confirm that `src/package.nls.json` user-facing strings use Deeptask naming.
- Confirm that `src/assets/icons/logo-outline-black.png` and related icon files contain the Deeptask icon.
- Do not add remote badges, screenshots, or images that point to non-Deeptask branding.

## Pull Requests

When preparing a change, include a clear description, testing steps, and screenshots for visual changes.

## Packaging Check

Before distributing a VSIX, inspect the package metadata and bundled assets to ensure the final artifact is `deeptask-5.5.0.vsix` and does not include snapshot/latest-version naming.
