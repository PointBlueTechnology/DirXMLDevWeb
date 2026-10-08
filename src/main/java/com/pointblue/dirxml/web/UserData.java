package com.pointblue.dirxml.web;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Instant;

/**
 * A person's own directory on a hosted server (docs/multi-user.md): {@code data.dir/users/<subject>},
 * created {@code 0700}, holding their credentials file ({@code environments.properties}: their bind
 * DN and password source per environment name, and any environment of their own) and a profile
 * for the operator's listing (subjects are opaque ids). The server process is one OS user, so the
 * separation is the server's: a person's directory is only ever reached through their session.
 */
public final class UserData {
    private final Path root;

    public UserData(Path dataDir) {
        this.root = dataDir.resolve("users");
    }

    /** The person's directory, created owner-only on first use. */
    public Path dir(Session.Principal who) throws IOException {
        Path dir = root.resolve(Workspaces.safe(who.subject));
        if (!Files.isDirectory(dir)) {
            Files.createDirectories(dir);
            try {
                Files.setPosixFilePermissions(dir, PosixFilePermissions.fromString("rwx------"));
            } catch (UnsupportedOperationException ignore) {
                // not a POSIX file system
            }
        }
        return dir;
    }

    /** Their credentials file; may not exist yet (the Connections view creates it owner-only). */
    public Path credentials(Session.Principal who) throws IOException {
        return dir(who).resolve("environments.properties");
    }

    /** Record who the subject is and when they were last here; never a secret. */
    public void touch(Session.Principal who) throws IOException {
        PropertiesFile pf = new PropertiesFile(dir(who).resolve("profile.properties"));
        pf.set("subject", who.subject);
        pf.set("name", who.name);
        pf.set("email", who.email);
        pf.set("lastSeen", Instant.now().toString());
        pf.save();
    }
}
