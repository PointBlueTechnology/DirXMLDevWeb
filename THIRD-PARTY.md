# Third-party components

DirXMLDevWeb's own code is under its [LICENSE](LICENSE) (MIT). A release ships the server jar, the
page, the single-user zip and a container image. These are the components they carry or load,
each under its own license. Keep these notices wherever you redistribute them. This file and the
license are in the container image at `/opt/idmweb/THIRD-PARTY.md` and `/opt/idmweb/LICENSE`, and the
file is attached to every release.

## In the server (the container image's `/opt/idmweb/lib`, or `~/.m2` for a workstation)

| Component | Version | What for | License |
|---|---|---|---|
| [DirXMLDev](https://github.com/PointBlueTechnology/DirXMLDev) `dirxml-dev` | as `pom.xml` pins | the core: model, validation, vault and driver operations | MIT, Point Blue Technology |
| [DirXMLSimulator](https://github.com/PointBlueTechnology/DirXMLSimulator) `dirxml-simulator` | as `pom.xml` pins | the policy simulator (it runs only with the customer's engine jars) | MIT, Point Blue Technology |
| [DirXMLTraceViewer](https://github.com/PointBlueTechnology/DirXMLTraceViewer) `dirxml-trace-core` | as `pom.xml` pins | the trace parser, highlighting and live trace over LDAP | MIT, Point Blue Technology |
| [directory-console](https://github.com/PointBlueTechnology/directory-console) `console-auth` | as `pom.xml` pins | sign-in (OIDC) for hosted mode | MIT, Point Blue Technology |
| JLDAP `com.novell.ldap:jldap` | 4.3 | the LDAP client: vault access, live trace | [The OpenLDAP Public License](http://www.openldap.org/software/release/license.html) |
| PostgreSQL JDBC driver `org.postgresql:postgresql` | 42.7.7 | the event store | BSD-2-Clause |

## In the page (the browser bundle)

| Component | Version | License |
|---|---|---|
| React, React DOM | 18.3.1 | MIT |
| Monaco Editor `monaco-editor` | 0.52.2 | MIT |
| `@monaco-editor/react`, `@monaco-editor/loader`, `state-local` | 4.7.0, 1.7.0, 1.0.7 | MIT |

## In the container image's base

The image is built on `eclipse-temurin:21-jre` (Eclipse Temurin OpenJDK: GPLv2 with the Classpath
Exception, on Ubuntu). It adds Debian/Ubuntu packages: `git`, `python3`, `curl`, `ca-certificates`
and `openssh-client`. Each is under its own license, which the image keeps under
`/usr/share/doc`.

## Pulled separately by the team-server compose file

Keycloak (`quay.io/keycloak/keycloak`, Apache-2.0) and Caddy (`caddy`, Apache-2.0) are not in the
image. `hosted/docker/compose.yml` names them and Docker pulls them from their own registries.

## Never included

The NetIQ/OpenText Identity Manager engine jars (`dirxml.jar`, `dirxml_misc.jar`, `nxsl.jar`, …).
`hosted/docker/build.sh` refuses to build an image that contains any of them. Validate's compile
check and the simulator load them from a `lib/` the customer mounts; vault access needs none of
them.

## Not affiliated with OpenText

DirXMLDevWeb is made by [Point Blue Technology](https://pointbluetech.com). It is not affiliated with,
endorsed by or supported by OpenText. NetIQ, eDirectory, Identity Manager and OpenText are trademarks of
OpenText or its affiliates; other names belong to their owners.
