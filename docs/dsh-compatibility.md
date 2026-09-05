# DSH compatibility baseline

`dsh-as-a-verifier` 0.2.6 was audited against DeepSeek Harness
`dsh-v0.1.3-alpha.1` at commit
`d347e703908d0406b7a7ef80e3a0e594d86b2215`.

The release keeps verifier protocol 1 and does not change its public runtime
API. The audit covers the function-plugin export shape, Cordis service and tool
registration, the profile bundle manifest, and the DSH seams used for atomic
cache writes, credentials, home-path resolution, launch environments, sessions,
and tool definitions.

The DSH release still supports Node `^22.19.0 || >=24.0.0` and uses pnpm 11.7.0.
Node 24 is the primary build, Git-install, and release-check runtime. CI also
runs the complete suite on the exact minimum Node 22.19.0 on Linux and Windows.

DSH `0.1.3-alpha.1` packages were not available from the npm registry at the
time of this audit. Development dependencies and profile-install smoke therefore
use the latest published `0.1.2-rc.1` packages, while peer ranges explicitly
accept both that installable release and the audited alpha release. A read-only
source-contract CI job checks the exact audited DSH commit so a future source pin
must be reviewed deliberately; the install baseline advances independently only
after the matching packages are published.
