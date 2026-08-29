# Security Policy

## Supported versions

OpenFab `0.x` is a public preview without a long-term support promise. Security fixes are applied to
the current preview line. A supported-version table will be added with `v1.0.0`.

## Report a vulnerability

Use GitHub private vulnerability reporting in the public OpenFab repository's **Security** tab. Do
not disclose a vulnerability in a public issue before a fix is available. If private reporting is
temporarily unavailable, open an issue containing no exploit details and request a secure contact
channel.

Include:

- the affected version or commit;
- the smallest independently authored synthetic reproducer;
- impact, prerequisites, and expected versus observed behavior;
- any safe mitigation you have already tested.

Never attach credentials, tokens, actual factory layouts, company or customer `.map` files,
operational data, private source, or internal documents. Replace them with synthetic OpenFab data.

## Scope

Security-sensitive areas include project import/export, local persistence and recovery, browser file
adapters, Worker message boundaries, cross-tab data exchange, dependency integrity, and the hosted
web application. Reports about a future simulation or 3D surface are welcome when that code is
present in the published source, even if the surface is not enabled by default.

## Disclosure

The maintainers will acknowledge a valid private report, investigate it against the canonical
public source, and coordinate disclosure after a fix and release path exist. No response-time SLA is
promised during `0.x` incubation.
