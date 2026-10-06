package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.deploy.SecretSource;
import java.io.IOException;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

/**
 * The hosted server's configuration ({@code hosted.properties}):
 * <pre>
 *   public.url=https://idm.example.com        # what the browser sees (behind the reverse proxy)
 *   bind=127.0.0.1                            # the proxy's side; 0.0.0.0 in a container
 *   port=8080
 *   data.dir=/var/lib/idmweb                  # workspaces, audit.log, git helper
 *   repo.url=https://github.com/org/idm-config.git
 *   repo.token=…  | repo.tokenEnv=… | repo.tokenCommand=… | repo.tokenKeychain=…
 *   repo.user=x-access-token                  # the user name the token goes with (GitHub: anything)
 *   repo.sshKey=/etc/idmweb/deploy_key        # or a deploy key, for a git@github.com: remote
 *   repo.base=main
 *   repo.tree=tree                            # the tree's directory inside the repository ('.' for the root)
 *   repo.cases=cases                          # the simulator corpus inside the repository
 *   catalog.dir=/srv/idm/catalog
 *   environments.file=/etc/idmweb/environments.properties
 *   identity=none | oidc
 *   none.users=alice:Alice Example:alice@example.com:idm-editors;bob:Bob:bob@example.com:idm-deployers
 *   oidc.issuer=https://login.example.com/realms/idm
 *   oidc.clientId=idmweb
 *   oidc.clientSecret=… (or Env/Command/Keychain)
 *   oidc.groupsClaim=groups                   # dotted path, e.g. realm_access.roles
 *   oidc.caFile=/etc/idmweb/idp-ca.crt        # a private CA to trust for the provider (a proxy's internal root)
 *   roles.editor=idm-editors,idm-deployers    # groups (or *) that may read, edit and commit
 *   roles.deployer=idm-deployers              # groups (or *) that may also deploy, control drivers and trace
 *   session.hours=8
 *   agents=ci:idm-deployers;claude:idm-editors   # non-browser callers: name:group1|group2
 *   agent.ci.tokenKeychain=idmweb/ci             # each agent's token (or .token, .tokenEnv, .tokenCommand)
 * </pre>
 * An agent sends {@code Authorization: Bearer <token>} and gets a session of its own, with the
 * roles its groups give and its name on every audit line; no cookie, so no CSRF token either.
 */
public final class Hosted {

    public final Path file;
    public final Properties props;
    public final String publicUrl;
    public final String bind;
    public final int port;
    public final Path dataDir;
    public final String repoUrl;
    public final String repoUser;
    public final Path repoSshKey;
    public final String repoBase;
    public final String repoTree;
    public final String repoCases;
    public final Path catalog;
    public final Path environmentsFile;
    public final String identity;
    public final List<String> editorGroups;
    public final List<String> deployerGroups;
    public final long sessionHours;

    private Hosted(Path file, Properties p) {
        this.file = file;
        this.props = p;
        this.publicUrl = required(p, "public.url").replaceAll("/+$", "");
        this.bind = p.getProperty("bind", "127.0.0.1").trim();
        this.port = Integer.parseInt(p.getProperty("port", "8080").trim());
        this.dataDir = Path.of(p.getProperty("data.dir", "data").trim()).toAbsolutePath().normalize();
        this.repoUrl = required(p, "repo.url");
        this.repoUser = p.getProperty("repo.user", "x-access-token").trim();
        String key = p.getProperty("repo.sshKey");
        this.repoSshKey = key == null || key.isBlank() ? null : Path.of(key.trim());
        this.repoBase = p.getProperty("repo.base", "main").trim();
        this.repoTree = p.getProperty("repo.tree", ".").trim();
        this.repoCases = p.getProperty("repo.cases", "cases").trim();
        String cat = p.getProperty("catalog.dir");
        this.catalog = cat == null || cat.isBlank() ? null : Path.of(cat.trim());
        String env = p.getProperty("environments.file");
        this.environmentsFile = env == null || env.isBlank() ? dataDir.resolve("environments.properties") : Path.of(env.trim());
        this.identity = p.getProperty("identity", "none").trim();
        this.editorGroups = list(p.getProperty("roles.editor", "*"));
        this.deployerGroups = list(p.getProperty("roles.deployer", ""));
        this.sessionHours = Long.parseLong(p.getProperty("session.hours", "8").trim());
    }

    public static Hosted load(Path file) throws IOException {
        Properties p = new Properties();
        try (StringReader r = new StringReader(Files.readString(file, StandardCharsets.UTF_8))) {
            p.load(r);
        }
        SecretSource.warnIfShared(file);
        return new Hosted(file.toAbsolutePath().normalize(), p);
    }

    private static String required(Properties p, String key) {
        String v = p.getProperty(key);
        if (v == null || v.isBlank()) {
            throw new IllegalArgumentException("hosted configuration needs " + key);
        }
        return v.trim();
    }

    static List<String> list(String csv) {
        List<String> out = new ArrayList<>();
        if (csv != null) {
            for (String s : csv.split(",")) {
                if (!s.isBlank()) {
                    out.add(s.trim());
                }
            }
        }
        return out;
    }

    /** The repository token, resolved through the same forms as every other credential; null when none. */
    public String repoToken() throws IOException {
        char[] v = SecretSource.resolve(props, "repo.token", "repo.token");
        if (v == null) {
            return null;
        }
        String s = new String(v);
        Arrays.fill(v, '\0');
        return s;
    }

    /** A secret of the configuration (the OIDC client secret, …), or null. */
    public String secret(String key) throws IOException {
        char[] v = SecretSource.resolve(props, key, key);
        if (v == null) {
            return null;
        }
        String s = new String(v);
        Arrays.fill(v, '\0');
        return s;
    }

    static boolean grants(List<String> groups, List<String> memberOf) {
        if (groups.contains("*")) {
            return true;
        }
        for (String g : memberOf) {
            if (groups.contains(g)) {
                return true;
            }
        }
        return false;
    }

    /** The roles a person's groups give them. */
    public Session.Principal principal(String subject, String name, String email, List<String> groups) {
        return new Session.Principal(subject, name, email, groups, grants(editorGroups, groups) || grants(deployerGroups, groups), grants(deployerGroups, groups));
    }

    /** The agents and their tokens, resolved once: token → principal. */
    public Map<String, Session.Principal> agents() throws IOException {
        Map<String, Session.Principal> out = new LinkedHashMap<>();
        for (String a : props.getProperty("agents", "").split(";")) {
            if (a.isBlank()) {
                continue;
            }
            String[] p = a.trim().split(":", 2);
            String name = p[0].trim();
            List<String> groups = p.length > 1 ? Arrays.asList(p[1].split("\\|")) : List.of();
            String token = secret("agent." + name + ".token");
            if (token == null || token.isBlank()) {
                throw new IllegalArgumentException("agent '" + name + "' has no token: set agent." + name + ".token (or .tokenEnv, .tokenCommand, .tokenKeychain)");
            }
            if (token.length() < 16) {
                throw new IllegalArgumentException("agent '" + name + "': a token is at least 16 characters");
            }
            out.put(token, principal("agent:" + name, name + " (agent)", null, groups));
        }
        return out;
    }

    /** The {@code none} provider's users: {@code subject:name:email:group1|group2;…}. */
    public List<Session.Principal> noneUsers() {
        List<Session.Principal> out = new ArrayList<>();
        for (String u : props.getProperty("none.users", "").split(";")) {
            if (u.isBlank()) {
                continue;
            }
            String[] p = u.trim().split(":", 4);
            List<String> groups = p.length > 3 ? Arrays.asList(p[3].split("\\|")) : List.of();
            out.add(principal(p[0], p.length > 1 ? p[1] : p[0], p.length > 2 ? p[2] : null, groups));
        }
        return out;
    }
}
