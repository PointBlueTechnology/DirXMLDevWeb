package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.deploy.SecretSource;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;

/**
 * A person's own Git provider tokens (#35 P2, docs/pull-requests.md §3): in their own directory
 * ({@code data.dir/users/<subject>/git.properties}, owner-only), by provider host, in the forms every
 * credential here takes: {@code <host>.token} (a literal in that file), {@code <host>.tokenEnv},
 * {@code <host>.tokenCommand} (a secret manager's CLI). Write-only: nothing here gives a value back
 * but {@link #resolve}, which the server uses to call the provider as that person.
 */
final class GitTokens {

    private final Path file;
    /**
     * A deployer's references (an environment variable, a command) are resolved; anyone else's are kept but never
     * resolved, since a hosted server resolves them as itself.
     */
    private final boolean references;

    GitTokens(Path file) {
        this(file, true);
    }

    GitTokens(Path file, boolean references) {
        this.file = file;
        this.references = references;
    }

    static GitTokens of(UserData users, Session.Principal who) throws IOException {
        return new GitTokens(users.dir(who).resolve("git.properties"), who.deployer);
    }

    static String host(String host) {
        String h = host == null ? "" : host.trim().toLowerCase(Locale.ROOT);
        if (!h.matches("[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\\d+)?")) {
            throw new TreeService.BadRequest("a provider host is a name like github.com or gitlab.example.com");
        }
        return h;
    }

    private Properties props() throws IOException {
        Properties p = new Properties();
        if (Files.isRegularFile(file)) {
            p.putAll(new PropertiesFile(file).entries());
        }
        return p;
    }

    /** How the person's token for {@code host} is kept: file, env:VAR, command, or null when there is none. */
    String store(String host) throws IOException {
        Properties p = props();
        String k = host(host) + ".token";
        if (p.getProperty(k) != null && !p.getProperty(k).isBlank()) {
            return "file";
        }
        if (p.getProperty(k + "Env") != null) {
            return "env:" + p.getProperty(k + "Env");
        }
        if (p.getProperty(k + "Command") != null) {
            return "command";
        }
        if (p.getProperty(k + "Keychain") != null) {
            return "keychain";
        }
        return null;
    }

    /** The person's token for {@code host}, or null. */
    String resolve(String host) throws IOException {
        if (host == null || !Files.isRegularFile(file)) {
            return null;
        }
        Properties p = props();
        String k = host(host) + ".token";
        String kind = store(host);
        if (!references && kind != null && !kind.equals("file")) {
            throw new IOException("it is " + CredentialService.readBy(kind.replaceAll(":.*", "")) + ", which only a deployer "
                + "may use on this server; keep the token in your own file instead");
        }
        char[] v = SecretSource.resolve(p, k, "your " + host + " token");
        return v == null || v.length == 0 ? null : new String(v);
    }

    /** Keep a token: {@code file} (the value, in this owner-only file), {@code env:VAR}, or {@code command:…}. */
    List<String> save(String host, String store, String value) throws IOException {
        String k = host(host) + ".token";
        if (store == null || store.isBlank()) {
            throw new TreeService.BadRequest("store is file, env:VAR or command:…");
        }
        if (!references && !store.equals("file")) {
            throw new Api.Forbidden("an environment variable or command (secret manager) reference is resolved on this "
                + "server as the server: only a deployer may save one; keep the token in your own file");
        }
        PropertiesFile pf = new PropertiesFile(file);
        clear(pf, k);
        List<String> notes = new ArrayList<>();
        if (store.equals("file")) {
            if (value == null || value.isBlank()) {
                throw new TreeService.BadRequest("no token given");
            }
            pf.set(k, value.trim());
            notes.add("token for " + host(host) + " kept in your own file (owner-only)");
        } else if (store.startsWith("env:") && store.length() > 4) {
            pf.set(k + "Env", store.substring(4).trim());
            notes.add("token for " + host(host) + " read from the server's environment variable " + store.substring(4).trim());
        } else if (store.startsWith("command:") && store.length() > 8) {
            pf.set(k + "Command", store.substring(8).trim());
            notes.add("token for " + host(host) + " read from a command's output");
        } else {
            throw new TreeService.BadRequest("store is file, env:VAR or command:…");
        }
        pf.save();
        return notes;
    }

    /** Forget the person's token for {@code host}; true when there was one. */
    boolean remove(String host) throws IOException {
        if (!Files.isRegularFile(file)) {
            return false;
        }
        PropertiesFile pf = new PropertiesFile(file);
        boolean had = clear(pf, host(host) + ".token");
        pf.save();
        return had;
    }

    private static boolean clear(PropertiesFile pf, String k) {
        boolean had = pf.entries().containsKey(k);
        pf.remove(k);
        for (String form : SecretSource.FORMS) {
            had |= pf.entries().containsKey(k + form);
            pf.remove(k + form);
        }
        return had;
    }

    /**
     * The provider hosts of the server's projects, each with its provider, its projects and how this person's
     * token for it is kept (never the value).
     */
    List<Map<String, Object>> hosts(Iterable<Project> projects) throws IOException {
        Map<String, Map<String, Object>> byHost = new LinkedHashMap<>();
        for (Project p : projects) {
            PullRequests.Target t;
            try {
                t = PullRequests.target(p.url, p.provider, p.apiUrl);
            } catch (IllegalArgumentException e) {
                continue;
            }
            if (t == null) {
                continue;
            }
            Map<String, Object> h = byHost.computeIfAbsent(t.host(), k -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("host", k);
                m.put("provider", t.provider().label);
                m.put("projects", new ArrayList<String>());
                return m;
            });
            @SuppressWarnings("unchecked")
            List<String> names = (List<String>) h.get("projects");
            names.add(p.name);
        }
        for (Map<String, Object> h : byHost.values()) {
            String store = store((String) h.get("host"));
            boolean refused = store != null && !store.equals("file") && !references;
            h.put("set", store != null && !refused);
            h.put("store", store);
            if (refused) {
                h.put("refused", true);   // kept in the file, never resolved here
            }
        }
        return new ArrayList<>(byHost.values());
    }
}
