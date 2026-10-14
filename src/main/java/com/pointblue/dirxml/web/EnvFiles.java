package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.deploy.Environments;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Where a workspace's environments come from (docs/multi-user.md): one file, as the CLI reads it
 * (local mode, and a hosted server before per-person credentials), or the project's
 * {@code definitions} merged with one person's {@code credentials}. Nothing here resolves a
 * secret; the core does that when an environment is opened.
 */
public record EnvFiles(Path definitions, Path credentials, boolean commands) {

    /** One file holding everything, the CLI's form. */
    public static EnvFiles single(Path file) {
        return new EnvFiles(file.toAbsolutePath().normalize(), null, true);
    }

    /** The project's definitions and one person's credentials, merged by the core. */
    public static EnvFiles split(Path definitions, Path credentials) {
        return split(definitions, credentials, true);
    }

    /**
     * The same, with {@code commands} false for a person who is not a deployer: a hosted server runs a command
     * reference as itself, so theirs are left out (docs/security.md) and asking for that secret says why.
     */
    public static EnvFiles split(Path definitions, Path credentials, boolean commands) {
        return new EnvFiles(definitions.toAbsolutePath().normalize(), credentials.toAbsolutePath().normalize(), commands);
    }

    public boolean isSplit() {
        return credentials != null;
    }

    /** The merged (or only) environments; an absent credentials file is an empty one. */
    public Environments load() throws IOException {
        if (credentials == null) {
            if (!Files.isRegularFile(definitions)) {
                throw new IOException("no environments file: " + definitions + " (set one up under Connections)");
            }
            return Environments.load(definitions);
        }
        return Environments.load(definitions, credentials, commands);
    }

    /** The file the Connections view writes a person's entries to: their credentials, else the one file. */
    public Path writeTarget() {
        return credentials == null ? definitions : credentials;
    }

    /** The CLI's lookup for local mode: {@code IDM_ENVIRONMENTS}, the working directory, else {@code ~/.idm}. */
    public static Path defaultFile() {
        String env = System.getenv("IDM_ENVIRONMENTS");
        if (env != null && !env.isBlank()) {
            return Paths.get(env).toAbsolutePath().normalize();
        }
        Path cwd = Paths.get("environments.properties").toAbsolutePath().normalize();
        if (Files.isRegularFile(cwd)) {
            return cwd;
        }
        return Paths.get(System.getProperty("user.home"), ".idm", "environments.properties");
    }
}
