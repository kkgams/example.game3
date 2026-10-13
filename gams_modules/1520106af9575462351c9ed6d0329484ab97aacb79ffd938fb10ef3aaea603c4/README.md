# theme.the98

Initial prerelease extraction of the GAMS `theme` Project Unit from
`themes/the98.css`. Source behavior is intentionally unchanged.
## Install mapping

Prospective local candidate: `theme.the98-0.2.0.zip` and `SHA256SUMS` for
`v0.2.0` (prepared, not yet published). After separately approved publication,
download and verify the checksum. Unpack into a separate staging
folder: copy its deployment files to the same Project-relative paths, and keep its
LICENSE, NOTICE, README.md and unit.json under `notices/project-units/theme.the98/`.
Do not unpack metadata over the Project's own README or license. The entry is
`themes/the98.css` (the archive strips `src/`). Configure that path in Project Config.
The example's checksum-pinned installer performs these steps for all Units.
Install dependencies listed below separately; they are not bundled.
The Host source contract targeted is 2.0.3; package-level GUI validation is a release
gate, not a claim about every future Host. See `PUBLISHING.md` for release gates.

## Current prerelease Host contract

This Unit runs inside the GAMS Host. Absolute JavaScript imports under `/core`,
`/util`, and `/widgets` are Host-owned package-library APIs and are deliberately not
vendored here. In particular, `/core/runtime.js` supplies plugin calls. There is no
arbitrary shared SDK repository. The Host must also provide the browser DOM/custom
elements environment and base/theme semantic CSS contract expected by the source.

Repository dependencies in this extraction set:
- None in this extraction set.

These are repository names only. Deployed JavaScript filenames and Project Config ids
remain unchanged. The list records actual static configuration/call boundaries; it
does not claim that every interaction has a standalone dynamic integration test.

## Verify

Requires Node.js 24 and Python 3 (stdlib only).

```sh
npm test
```

Verification scans Unit-owned `src/` assets plus its test script/package/workflow
metadata, checks each JavaScript file in that boundary with `node --check`, rejects
unresolved or escaping local imports/assets, permits only the documented Host
absolute import roots, and resolves non-data CSS `url(...)` assets. Git internals,
dependency installs, and build outputs are outside the scan boundary.

## Release status

GAMS-authored code is Apache-2.0. `package.json` remains private: distribution is a
GitHub Release ZIP, never npm or OCI. Owner-reviewed LICENSE/NOTICE digest variables
and release-branch/tag checks gate publication. Identified third-party terms are
retained in NOTICE, including 98.css MIT terms for the theme. See `LICENSING.md`
and `PUBLISHING.md`.
