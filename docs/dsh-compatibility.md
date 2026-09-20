# DSH compatibility baseline

`dsh-as-a-verifier` 0.2.7 was audited against DeepSeek Harness
`dsh-v0.1.5-rc.2` at commit
`fb2c4b9e698e30edb738bca4cf0618587db7d203`.

The release keeps verifier protocol 1 and does not change its public runtime
API. The audit covers the function-plugin export shape, Cordis service and tool
registration, the profile bundle manifest, and the DSH seams used for atomic
cache writes, credentials, home-path resolution, launch environments, sessions,
and tool definitions.

The DSH release still supports Node `^22.19.0 || >=24.0.0` and uses pnpm 11.7.0.
Node 24 is the primary build, Git-install, and release-check runtime. CI also
runs the complete suite on the exact minimum Node 22.19.0 on Linux and Windows.

Development dependencies, profile-install smoke, and the read-only source check
all use the published `0.1.5-rc.2` release. This release is the minimum DSH peer
version; older prereleases are no longer part of the compatibility promise. The
exact source commit remains pinned so a future DSH update must be reviewed deliberately.
