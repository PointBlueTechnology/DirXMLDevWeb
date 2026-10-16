package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.ascode.AsCodeReader;
import com.pointblue.dirxml.dev.deploy.Environments;
import com.pointblue.dirxml.dev.deploy.SecretInventory;
import com.pointblue.dirxml.dev.deploy.SecretSource;
import com.pointblue.dirxml.dev.deploy.Vault;
import com.pointblue.dirxml.dev.json.Json;
import com.pointblue.dirxml.dev.model.Driver;
import com.pointblue.dirxml.dev.model.DriverSet;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.regex.Pattern;

/**
 * Connections and credentials, set up from the page: the environments file the CLI reads
 * (vault URL, bind DN, driver set, tier, trust, SSH) and each environment's driver secrets
 * file. A password or secret arrives once, over the loopback connection, and goes to a store:
 * the macOS Keychain by default, else a literal in the owner-only file. Nothing here returns a
 * value: reads describe each credential by the kind of its source only.
 */
public final class CredentialService {

    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9_.-]*");
    /** Properties of an environment the page may set, besides the password. */
    private static final List<String> FIELDS = List.of("url", "bindDn", "driverSet", "tier", "trustAll", "certSha256", "servers", "requires", "sshHost", "sshUser", "secrets", "eventsUrl", "eventsUser", "eventsTable", "eventsPseudonymise", "eventsTree");
    /** With two files (docs/multi-user.md): the project's definition holds these… */
    private static final List<String> DEFINITION_FIELDS = List.of("url", "driverSet", "tier", "certSha256", "servers", "requires", "sshHost", "sshUser", "secrets", "eventsUrl", "eventsUser", "eventsTable", "eventsPseudonymise", "eventsTree");
    /** …and a person's credential holds these, plus the password. */
    private static final List<String> CREDENTIAL_FIELDS = List.of("bindDn", "trustAll");
    private static final String KEYCHAIN_PREFIX = "idm-";

    private final Path tree;
    private final EnvFiles files;

    public CredentialService(Path tree, EnvFiles files) {
        this.tree = tree.toAbsolutePath().normalize();
        this.files = files;
    }

    /** The file the page's entries go to: the person's credentials, or the one file. */
    private Path environmentsFile() {
        return files.writeTarget();
    }

    /** The definitions (two files) or the one file: where the driver secrets and the non-secret keys live. */
    private Path definitionsFile() {
        return files.definitions();
    }

    private static Map<String, String> entries(Path f) throws IOException {
        return Files.isRegularFile(f) ? new PropertiesFile(f).entries() : Map.of();
    }

    /** Every key the core would see: the definitions, then the person's keys over them. */
    private Map<String, String> merged() throws IOException {
        Map<String, String> m = new LinkedHashMap<>(entries(definitionsFile()));
        if (files.isSplit()) {
            m.putAll(entries(files.credentials()));
        }
        return m;
    }

    private static List<String> namesOf(Map<String, String> props) {
        List<String> names = new ArrayList<>();
        for (String k : props.keySet()) {
            int dot = k.indexOf('.');
            if (dot > 0 && !names.contains(k.substring(0, dot))) {
                names.add(k.substring(0, dot));
            }
        }
        return names;
    }

    static boolean keychainAvailable() {
        return System.getProperty("os.name", "").toLowerCase().contains("mac");
    }

    /**
     * Whether this person's own references are left out (a hosted server, someone who is not a deployer): the
     * server would resolve them as itself, from its own environment, shell or Keychain (docs/security.md).
     */
    boolean refusesReferences() {
        return files.isSplit() && !files.references();
    }

    /** Whether a key configured as {@code kind} ({@link #sourceKind}) is one this person may not use here. */
    private boolean refused(String kind) {
        return refusesReferences() && kind != null && !kind.equals("literal");
    }

    static String readBy(String kind) {
        return switch (kind) {
            case "env" -> "read from an environment variable";
            case "command" -> "read by a command";
            case "keychain" -> "read from the Keychain";
            default -> "a reference";
        };
    }

    static final String REFUSED_STORE = "an environment variable, command (secret manager) or Keychain reference is resolved "
        + "on this server as the server: only a deployer may save one; keep the password in your own file";

    /** How a key is configured: literal, env, command, keychain, or null. */
    static String sourceKind(Map<String, String> props, String key) {
        if (props.containsKey(key)) {
            return "literal";
        }
        for (String f : SecretSource.FORMS) {
            if (props.containsKey(key + f)) {
                return f.toLowerCase();
            }
        }
        return null;
    }

    private static String nameOk(String name) {
        if (name == null || !NAME.matcher(name).matches()) {
            throw new TreeService.BadRequest("an environment name is letters, digits, '.', '_' and '-'");
        }
        return name;
    }

    /** Every environment with what is configured (never a value), and where the file is. */
    public Map<String, Object> list() throws IOException {
        Path f = environmentsFile();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("file", f.toString());
        m.put("exists", Files.isRegularFile(f));
        m.put("split", files.isSplit());
        if (files.isSplit()) {
            m.put("definitions", definitionsFile().toString());
        }
        m.put("keychain", keychainAvailable());
        m.put("helpers", Paths.get(System.getProperty("idmweb.home", System.getProperty("user.dir")), "bin", "secrets").toAbsolutePath().normalize().toString());
        List<Object> envs = new ArrayList<>();
        Map<String, String> defs = entries(definitionsFile());
        Map<String, String> mine = files.isSplit() ? entries(files.credentials()) : defs;
        Map<String, String> props = merged();
        List<String> names = namesOf(props);
        List<String> defined = namesOf(defs);
        for (String n : names) {
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("name", n);
            for (String field : FIELDS) {
                e.put(field, props.get(n + "." + field));
            }
            e.put("password", sourceKind(mine, n + ".password"));
            e.put("eventsPassword", sourceKind(mine, n + ".eventsPassword"));
            // a reference a person who is not a deployer saved: kept in their file, never resolved here
            boolean refused = refused(sourceKind(mine, n + ".password"));
            if (refused) {
                e.put("passwordRefused", true);
            }
            if (refused(sourceKind(mine, n + ".eventsPassword"))) {
                e.put("eventsPasswordRefused", true);
            }
            e.put("secretsFile", secretsFile(definitionsFile(), props, n).toString());
            e.put("secretsFileExists", Files.isRegularFile(secretsFile(definitionsFile(), props, n)));
            boolean connected = mine.get(n + ".bindDn") != null && sourceKind(mine, n + ".password") != null && !refused;
            boolean ready = props.get(n + ".url") != null && props.get(n + ".driverSet") != null && connected;
            e.put("ready", ready);
            if (files.isSplit()) {
                e.put("defined", defined.contains(n));
                e.put("own", !defined.contains(n));
                e.put("connected", connected);
            }
            envs.add(e);
        }
        m.put("environments", envs);
        return m;
    }

    /** The driver secrets file: beside the definitions, shared by everyone who deploys there. */
    private static Path secretsFile(Path envFile, Map<String, String> props, String env) {
        String s = props.get(env + ".secrets");
        Path dir = envFile.getParent() == null ? Paths.get(".") : envFile.getParent();
        return s == null || s.isBlank() ? dir.resolve("secrets-" + env + ".properties") : dir.resolve(s.trim()).normalize();
    }

    /** Try the parameters as given (the password typed, or the environment's configured one); nothing is saved. */
    /**
     * The driver sets a vault holds, for the connection form's picker: the same connection the test
     * makes (a URL, a bind DN, a password given or an environment's), one subtree search for
     * {@code DirXML-DriverSet} from the root. Nothing is written.
     */
    public Map<String, Object> driverSets(Map<String, Object> req) throws IOException {
        Vault.Config c = new Vault.Config();
        c.url = Json.asString(req.get("url"));
        c.bindDn = Json.asString(req.get("bindDn"));
        c.trustAll = Boolean.TRUE.equals(req.get("trustAll"));
        c.certSha256 = pinOf(req);
        String password = Json.asString(req.get("password"));
        String env = Json.asString(req.get("env"));
        Map<String, Object> m = new LinkedHashMap<>();
        if (c.url == null || c.url.isBlank() || c.bindDn == null || c.bindDn.isBlank()) {
            throw new TreeService.BadRequest("a URL and a bind DN are needed");
        }
        if (password == null || password.isEmpty()) {
            if (env == null || env.isBlank()) {
                throw new TreeService.BadRequest("no password given, and no environment to take one from");
            }
            try {
                c.password = files.load().get(nameOk(env)).password;
            } catch (IOException e) {
                m.put("ok", false);
                m.put("message", e.getMessage());
                return m;
            }
        } else {
            c.password = password;
        }
        try (Vault v = Vault.connect(c)) {
            List<Map<String, Object>> sets = new java.util.ArrayList<>();
            for (Vault.Entry e : v.search("", "(objectClass=DirXML-DriverSet)", javax.naming.directory.SearchControls.SUBTREE_SCOPE)) {
                Map<String, Object> d = new LinkedHashMap<>();
                d.put("dn", e.dn);
                d.put("name", e.string("cn"));
                List<String> servers = new java.util.ArrayList<>();
                List<byte[]> sl = e.attrs.get("DirXML-ServerList");
                if (sl != null) {
                    for (byte[] b : sl) {
                        servers.add(new String(b, java.nio.charset.StandardCharsets.UTF_8));
                    }
                }
                d.put("servers", servers);
                sets.add(d);
            }
            sets.sort((a, b) -> String.valueOf(a.get("dn")).compareToIgnoreCase(String.valueOf(b.get("dn"))));
            m.put("ok", true);
            m.put("driverSets", sets);
            m.put("message", sets.isEmpty() ? "Connected, but the account sees no driver set." : sets.size() + " driver set(s).");
        } catch (RuntimeException e) {
            m.put("ok", false);
            m.put("message", scrub(e.getMessage() == null ? e.toString() : e.getMessage(), c.password));
        }
        return m;
    }

    public Map<String, Object> test(Map<String, Object> req) throws IOException {
        Vault.Config c = new Vault.Config();
        c.url = Json.asString(req.get("url"));
        c.bindDn = Json.asString(req.get("bindDn"));
        c.trustAll = Boolean.TRUE.equals(req.get("trustAll"));
        c.certSha256 = pinOf(req);
        String driverSet = Json.asString(req.get("driverSet"));
        String password = Json.asString(req.get("password"));
        String env = Json.asString(req.get("env"));
        Map<String, Object> m = new LinkedHashMap<>();
        if (c.url == null || c.url.isBlank() || c.bindDn == null || c.bindDn.isBlank()) {
            throw new TreeService.BadRequest("a URL and a bind DN are needed");
        }
        if (password == null || password.isEmpty()) {
            if (env == null || env.isBlank()) {
                throw new TreeService.BadRequest("no password given, and no environment to take one from");
            }
            try {
                c.password = files.load().get(nameOk(env)).password;
            } catch (IOException e) {
                m.put("ok", false);
                m.put("message", e.getMessage());
                return m;
            }
        } else {
            c.password = password;
        }
        // the sign-in in words (docs/connections-ui.md): ok, rejected (and why), certificate, unreachable
        com.pointblue.dirxml.dev.deploy.SignIn.Check check = com.pointblue.dirxml.dev.deploy.SignIn.check(c);
        m.put("ok", check.state == com.pointblue.dirxml.dev.deploy.SignIn.State.OK);
        m.put("check", scrubbed(check.json(), c.password));
        m.put("message", scrub(check.message == null ? String.valueOf(check.state) : check.message, c.password));
        if (check.state == com.pointblue.dirxml.dev.deploy.SignIn.State.OK && driverSet != null && !driverSet.isBlank()) {
            try (Vault v = Vault.connect(c)) {
                boolean there = v.exists(driverSet);
                m.put("driverSetFound", there);
                m.put("message", there ? check.message + "; the driver set is there." : check.message + ", but there's no driver set at " + driverSet + ".");
            } catch (RuntimeException e) {
                m.put("message", scrub(e.getMessage() == null ? e.toString() : e.getMessage(), c.password));
            }
        }
        return m;
    }

    /** The pin a request names, else the named environment's, else none. */
    private String pinOf(Map<String, Object> req) throws IOException {
        String pin = Json.asString(req.get("certSha256"));
        if (pin != null && !pin.isBlank()) {
            return com.pointblue.dirxml.dev.deploy.PinnedTrust.normalize(pin);
        }
        String env = Json.asString(req.get("env"));
        if (env == null || env.isBlank()) {
            return null;
        }
        return com.pointblue.dirxml.dev.deploy.PinnedTrust.normalize(merged().get(env + ".certSha256"));
    }

    private static Map<String, Object> scrubbed(Map<String, Object> m, String password) {
        Map<String, Object> out = new LinkedHashMap<>(m);
        for (Map.Entry<String, Object> e : out.entrySet()) {
            if (e.getValue() instanceof String str) {
                e.setValue(scrub(str, password));
            }
        }
        return out;
    }

    /** The certificate at an address, for the page to show and pin (nothing is saved, nobody signs in). */
    public Map<String, Object> certificate(Map<String, Object> req) {
        String url = Json.asString(req.get("url"));
        if (url == null || !url.trim().toLowerCase(java.util.Locale.ROOT).startsWith("ldaps://")) {
            throw new TreeService.BadRequest("a certificate needs an ldaps:// address");
        }
        Map<String, Object> m = new LinkedHashMap<>();
        try {
            m.putAll(com.pointblue.dirxml.dev.deploy.SignIn.probe(url.trim(), 6000).json());
            m.put("ok", true);
        } catch (Exception e) {
            m.put("ok", false);
            m.put("message", "Can't reach " + url.trim() + ": " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
        }
        return m;
    }

    /** Sign-in checks, per credentials file and environment, so the top bar and the list don't bind on every request. */
    private static final Map<String, Map<String, Object>> CHECKS = new java.util.concurrent.ConcurrentHashMap<>();
    private static final long FRESH_MS = 5 * 60 * 1000;

    /** One environment's sign-in, as the person's own files configure it; {@code fresh}: never from the cache. */
    public Map<String, Object> check(String env, boolean fresh) throws IOException {
        nameOk(env);
        String key = (files.isSplit() ? files.credentials() : environmentsFile()) + "#" + env;
        Map<String, Object> cached = CHECKS.get(key);
        if (!fresh && cached != null && System.currentTimeMillis() - ((Number) cached.get("checkedAt")).longValue() < FRESH_MS) {
            return cached;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("env", env);
        Environments.Environment e;
        try {
            e = files.load().get(env);
        } catch (IOException | RuntimeException ex) {
            m.put("state", "not-signed-in");
            m.put("message", ex.getMessage());
            m.put("checkedAt", System.currentTimeMillis());
            CHECKS.put(key, m);
            return m;
        }
        Vault.Config c = e.vaultConfig();
        m.putAll(scrubbed(com.pointblue.dirxml.dev.deploy.SignIn.check(c).json(), c.password));
        m.put("env", env);
        if ("ok".equals(m.get("state"))) {
            // a driver set on several servers: how many of the others this server can reach (#134)
            try {
                List<Map<String, Object>> servers = serverRows(e);
                if (servers.size() > 1) {
                    List<String> down = new ArrayList<>();
                    for (Map<String, Object> r : servers) {
                        if (!Boolean.TRUE.equals(r.get("reachable"))) {
                            down.add(String.valueOf(r.get("name")));
                        }
                    }
                    m.put("servers", servers.size());
                    m.put("serversUnreachable", down);
                }
            } catch (RuntimeException ignored) {
                // the summary is extra: the sign-in answer stands
            }
        }
        m.put("checkedAt", System.currentTimeMillis());
        CHECKS.put(key, m);
        return m;
    }

    /**
     * The driver set's servers (#134, docs/connections-ui.md): each with the address it is reached at (the
     * environment's {@code servers=} entry, else the one derived from its server object; the connection's own
     * server is the environment's URL), and whether a connection to that address opens within three seconds.
     */
    public Map<String, Object> servers(String env) throws IOException {
        Environments.Environment e = files.load().get(nameOk(env));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("env", env);
        m.put("servers", serverRows(e));
        return m;
    }

    private static List<Map<String, Object>> serverRows(Environments.Environment e) {
        Map<String, String> configured = com.pointblue.dirxml.dev.deploy.Servers.urls(e);
        List<Map<String, Object>> rows = new ArrayList<>();
        try (Vault v = Vault.connect(e.vaultConfig())) {
            String primary = com.pointblue.dirxml.dev.deploy.Servers.primary(v);
            for (String dn : com.pointblue.dirxml.dev.deploy.Servers.serverList(v, e.driverSetDn)) {
                Map<String, Object> r = new LinkedHashMap<>();
                boolean isPrimary = primary != null && primary.equalsIgnoreCase(dn);
                String mine = null;
                for (Map.Entry<String, String> c : configured.entrySet()) {
                    if (c.getKey().equalsIgnoreCase(dn)) {
                        mine = c.getValue();
                    }
                }
                String derived = null;
                try {
                    derived = com.pointblue.dirxml.dev.deploy.Servers.deriveUrl(v, dn);
                } catch (RuntimeException ignored) {
                    // no address on the server object
                }
                String used = isPrimary ? e.url : mine != null ? mine : derived;
                r.put("dn", dn);
                r.put("name", dn.replaceFirst("^[^=]+=", "").replaceFirst(",.*$", ""));
                r.put("primary", isPrimary);
                r.put("configured", mine);
                r.put("derived", derived);
                r.put("url", used);
                if (isPrimary) {
                    r.put("reachable", true);
                } else if (used == null) {
                    r.put("reachable", false);
                    r.put("message", "No address: give one.");
                } else {
                    String why = reach(used);
                    r.put("reachable", why == null);
                    r.put("message", why);
                }
                rows.add(r);
            }
        }
        return rows;
    }

    /** Null when a TCP connection to the URL's host and port opens within three seconds, else why not. */
    static String reach(String url) {
        try {
            java.net.URI u = java.net.URI.create(url.contains("://") ? url : "ldaps://" + url);
            int port = u.getPort() > 0 ? u.getPort() : "ldap".equalsIgnoreCase(u.getScheme()) ? 389 : 636;
            try (java.net.Socket s = new java.net.Socket()) {
                s.connect(new java.net.InetSocketAddress(u.getHost(), port), 3000);
            }
            return null;
        } catch (Exception ex) {
            return "Can't reach " + url + ": " + (ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage());
        }
    }

    /** The person's environments whose sign-in needs them: rejected, certificate, unreachable, or expiring soon. */
    public Map<String, Object> problems() throws IOException {
        List<Map<String, Object>> out = new ArrayList<>();
        Map<String, String> mine = files.isSplit() ? entries(files.credentials()) : entries(definitionsFile());
        for (String n : namesOf(merged())) {
            if (mine.get(n + ".bindDn") == null || sourceKind(mine, n + ".password") == null) {
                continue;   // not signed in: the list says so; nothing to warn about
            }
            Map<String, Object> c = check(n, false);
            String state = String.valueOf(c.get("state"));
            Object days = c.get("daysLeft");
            boolean expiring = days instanceof Number d && d.longValue() <= 14;
            if (!state.equals("ok") || expiring) {
                out.add(c);
            }
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("problems", out);
        return m;
    }

    /** A message with the password removed, should a library ever echo it. */
    private static String scrub(String message, String password) {
        return password == null || password.isEmpty() ? message : message.replace(password, "•••");
    }

    /**
     * Create or change an environment. {@code passwordStore} says where a given password goes:
     * {@code keychain} (macOS), {@code file} (a literal in the owner-only environments file),
     * {@code env:VAR} or {@code command:…} (the page gives no password; the reference is stored).
     * Without a password the configured one is kept.
     */
    public Map<String, Object> save(Map<String, Object> req) throws IOException {
        String name = nameOk(Json.asString(req.get("name")));
        if (files.isSplit()) {
            // the project's definition: no secret, no bind identity — those are each person's own
            if (req.get("password") != null || req.get("passwordStore") != null) {
                throw new TreeService.BadRequest("a password belongs to your own connection (My connections), not to the project's definition");
            }
            Path f = definitionsFile();
            PropertiesFile pf = new PropertiesFile(f);
            for (String field : DEFINITION_FIELDS) {
                if (req.containsKey(field)) {
                    Object v = req.get(field);
                    String s = v == null ? null : String.valueOf(v).trim();
                    pf.set(name + "." + field, s == null || s.isEmpty() ? null : s);
                }
            }
            pf.save();
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", name);
            m.put("file", f.toString());
            m.put("notes", List.of());
            return m;
        }
        Path f = environmentsFile();
        PropertiesFile pf = new PropertiesFile(f);
        for (String field : FIELDS) {
            if (req.containsKey(field)) {
                Object v = req.get(field);
                String s = v == null ? null : String.valueOf(v).trim();
                pf.set(name + "." + field, s == null || s.isEmpty() || "false".equals(s) && field.equals("trustAll") ? null : s);
            }
        }
        List<String> notes = new ArrayList<>();
        storePassword(pf, name, "password", Json.asString(req.get("passwordStore")), Json.asString(req.get("password")), f, notes);
        storePassword(pf, name, "eventsPassword", Json.asString(req.get("eventsPasswordStore")), Json.asString(req.get("eventsPassword")), f, notes);
        pf.save();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("file", f.toString());
        m.put("notes", notes);
        return m;
    }

    /**
     * A person's own connection to an environment (two files only): their bind DN, trust choice and
     * where their password comes from. For a name the project does not define, their file takes the
     * definition fields too (an environment of their own).
     */
    public Map<String, Object> saveMine(Map<String, Object> req) throws IOException {
        if (!files.isSplit()) {
            throw new TreeService.BadRequest("this server keeps one environments file; use the environment form");
        }
        String name = nameOk(Json.asString(req.get("name")));
        boolean defined = namesOf(entries(definitionsFile())).contains(name);
        Path f = files.credentials();
        PropertiesFile pf = new PropertiesFile(f);
        List<String> fields = new ArrayList<>(CREDENTIAL_FIELDS);
        if (!defined) {
            fields.addAll(DEFINITION_FIELDS);
        }
        for (String field : fields) {
            if (req.containsKey(field)) {
                Object v = req.get(field);
                String s = v == null ? null : String.valueOf(v).trim();
                pf.set(name + "." + field, s == null || s.isEmpty() || "false".equals(s) && field.equals("trustAll") ? null : s);
            }
        }
        if (refusesReferences()) {
            for (String k : new String[] {"passwordStore", "eventsPasswordStore"}) {
                String st = Json.asString(req.get(k));
                if (st != null && !st.isBlank() && !st.equals("file")) {
                    throw new Api.Forbidden(REFUSED_STORE);
                }
            }
        }
        List<String> notes = new ArrayList<>();
        storePassword(pf, name, "password", Json.asString(req.get("passwordStore")), Json.asString(req.get("password")), f, notes);
        storePassword(pf, name, "eventsPassword", Json.asString(req.get("eventsPasswordStore")), Json.asString(req.get("eventsPassword")), f, notes);
        pf.save();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("file", f.toString());
        m.put("own", !defined);
        m.put("notes", notes);
        return m;
    }

    /** Forget a person's connection to an environment: their keys for the name, nothing else. */
    public Map<String, Object> removeMine(String name) throws IOException {
        if (!files.isSplit()) {
            throw new TreeService.BadRequest("this server keeps one environments file; use the environment form");
        }
        nameOk(name);
        PropertiesFile pf = new PropertiesFile(files.credentials());
        int n = 0;
        for (String k : new ArrayList<>(pf.entries().keySet())) {
            if (k.startsWith(name + ".")) {
                pf.remove(k);
                n++;
            }
        }
        pf.save();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("removed", n);
        return m;
    }

    /** Where a given password goes, as {@link #save} documents; nothing when no store is named. */
    private static void storePassword(PropertiesFile pf, String name, String key, String store, String password, Path f, List<String> notes) throws IOException {
        if (store != null && !store.isBlank()) {
            if (store.equals("keychain") || store.equals("file")) {
                if (password == null || password.isEmpty()) {
                    throw new TreeService.BadRequest("no " + (key.equals("password") ? "password" : key) + " given");
                }
            }
            clearPassword(pf, name, key);
            if (store.equals("keychain")) {
                if (!keychainAvailable()) {
                    throw new TreeService.BadRequest("the Keychain is macOS only; store the password in the file, an environment variable or a command");
                }
                String service = KEYCHAIN_PREFIX + name + (key.equals("password") ? "" : "/" + key);
                String account = pf.entries().getOrDefault(name + ".bindDn", "vault");
                keychainPut(service, account, password);
                pf.set(name + "." + key + "Keychain", service + "/" + account);
                notes.add(key + " stored in the Keychain as " + service + " / " + account);
            } else if (store.equals("file")) {
                pf.set(name + "." + key, password);
                notes.add(key + " stored as a literal in " + f + " (owner-only)");
            } else if (store.startsWith("env:")) {
                pf.set(name + "." + key + "Env", store.substring(4).trim());
            } else if (store.startsWith("command:")) {
                pf.set(name + "." + key + "Command", store.substring(8).trim());
            } else {
                throw new TreeService.BadRequest("passwordStore is keychain, file, env:VAR or command:…");
            }
        }
    }

    private static void clearPassword(PropertiesFile pf, String name, String key) {
        pf.remove(name + "." + key);
        for (String form : SecretSource.FORMS) {
            pf.remove(name + "." + key + form);
        }
    }

    /** Remove an environment's lines; its secrets file and Keychain items stay. */
    public Map<String, Object> remove(String name) throws IOException {
        nameOk(name);
        Path f = definitionsFile();
        PropertiesFile pf = new PropertiesFile(f);
        int n = 0;
        for (String k : new ArrayList<>(pf.entries().keySet())) {
            if (k.startsWith(name + ".")) {
                pf.remove(k);
                n++;
            }
        }
        pf.save();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("removed", n);
        return m;
    }

    /** The secrets the tree's drivers need for an environment, and which the secrets file configures. */
    public Map<String, Object> secrets(String env) throws IOException {
        nameOk(env);
        Path sf = secretsFile(definitionsFile(), merged(), env);
        Map<String, String> configured = Files.isRegularFile(sf) ? new PropertiesFile(sf, true).entries() : Map.of();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("environment", env);
        m.put("file", sf.toString());
        m.put("exists", Files.isRegularFile(sf));
        List<Object> needs = new ArrayList<>();
        List<String> seen = new ArrayList<>();
        DriverSet ds = Files.isRegularFile(tree.resolve("driverset.xml")) ? AsCodeReader.read(tree) : new DriverSet("none");
        for (Driver d : ds.drivers) {
            for (SecretInventory.Need need : SecretInventory.forDriver(ds, d)) {
                Map<String, Object> one = new LinkedHashMap<>();
                one.put("driver", d.name);
                one.put("key", need.key);
                one.put("kind", need.kind);
                one.put("because", need.because);
                one.put("configured", sourceKind(configured, need.key));
                needs.add(one);
                seen.add(need.key);
            }
        }
        m.put("needs", needs);
        List<Object> extra = new ArrayList<>();
        for (String k : configured.keySet()) {
            String base = SecretSource.baseKey(k);
            if (!seen.contains(base) && !extra.contains(base)) {
                Map<String, Object> one = new LinkedHashMap<>();
                one.put("key", base);
                one.put("configured", sourceKind(configured, base));
                extra.add(one);
            }
        }
        m.put("others", extra);
        return m;
    }

    /** Store one driver secret for an environment; {@code value} is empty for a reference store (env, command) or to remove. */
    public Map<String, Object> setSecret(Map<String, Object> req) throws IOException {
        String env = nameOk(Json.asString(req.get("env")));
        String key = Json.asString(req.get("key"));
        String store = Json.asString(req.get("store"));
        String value = Json.asString(req.get("value"));
        if (key == null || key.isBlank() || key.contains("\n") || key.contains("=")) {
            throw new TreeService.BadRequest("a secret key is needed, e.g. AD Driver.shim-auth-password");
        }
        Path f = definitionsFile();
        PropertiesFile envs = new PropertiesFile(f);
        Path sf = secretsFile(f, merged(), env);
        if (!envs.entries().containsKey(env + ".secrets")) {
            envs.set(env + ".secrets", sf.getFileName().toString());
            envs.save();
        }
        PropertiesFile pf = new PropertiesFile(sf, true);
        pf.remove(key);
        for (String form : SecretSource.FORMS) {
            pf.remove(key + form);
        }
        List<String> notes = new ArrayList<>();
        if (store == null || store.equals("remove")) {
            notes.add("removed");
        } else if (store.equals("keychain")) {
            if (!keychainAvailable()) {
                throw new TreeService.BadRequest("the Keychain is macOS only");
            }
            if (value == null || value.isEmpty()) {
                throw new TreeService.BadRequest("no value given");
            }
            keychainPut(KEYCHAIN_PREFIX + env, key, value);
            pf.set(key + "Keychain", KEYCHAIN_PREFIX + env + "/" + key);
            notes.add("stored in the Keychain as " + KEYCHAIN_PREFIX + env + " / " + key);
        } else if (store.equals("file")) {
            if (value == null || value.isEmpty()) {
                throw new TreeService.BadRequest("no value given");
            }
            pf.set(key, value);
            notes.add("stored as a literal in " + sf + " (owner-only)");
        } else if (store.startsWith("env:")) {
            pf.set(key + "Env", store.substring(4).trim());
        } else if (store.startsWith("command:")) {
            pf.set(key + "Command", store.substring(8).trim());
        } else {
            throw new TreeService.BadRequest("store is keychain, file, env:VAR, command:… or remove");
        }
        pf.save();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", key);
        m.put("file", sf.toString());
        m.put("notes", notes);
        return m;
    }

    /**
     * Does a reference yield a value? Either a configured credential ({@code env} and, for a driver
     * secret, {@code key}) or a {@code command} not yet saved. The value is read, measured and
     * discarded; the answer is whether something came back and why not otherwise.
     */
    public Map<String, Object> resolve(Map<String, Object> req) throws IOException {
        String env = Json.asString(req.get("env"));
        String key = Json.asString(req.get("key"));
        String command = Json.asString(req.get("command"));
        Properties props = new Properties();
        String what;
        if (command != null && !command.isBlank()) {
            props.setProperty("xCommand", command);
            key = "x";
            what = "the command";
        } else {
            nameOk(env);
            Map<String, String> envProps = merged();
            if (key == null || key.isBlank()) {
                key = env + ".password";
                props.putAll(envProps);
                what = "the password of '" + env + "'";
                String kind = refusesReferences() ? sourceKind(entries(files.credentials()), key) : null;
                if (refused(kind)) {
                    // the person's own reference: never resolved here for someone who is not a deployer
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("ok", false);
                    m.put("message", what + " is " + readBy(kind) + ", which only a deployer may use on this server");
                    return m;
                }
            } else {
                Path sf = secretsFile(definitionsFile(), envProps, env);
                if (Files.isRegularFile(sf)) {
                    props.putAll(new PropertiesFile(sf, true).entries());
                }
                what = "secret '" + key + "'";
            }
        }
        Map<String, Object> m = new LinkedHashMap<>();
        try {
            char[] v = SecretSource.resolve(props, key, what);
            if (v == null) {
                m.put("ok", false);
                m.put("message", what + " is not configured");
            } else {
                boolean blank = new String(v).isBlank();
                java.util.Arrays.fill(v, '\0');
                m.put("ok", !blank);
                m.put("message", blank ? what + " resolved to nothing (empty output)" : what + " resolves to a value");
            }
        } catch (IOException e) {
            m.put("ok", false);
            m.put("message", e.getMessage());
        }
        return m;
    }

    /** Add or replace a generic Keychain item. The value goes on the command line of a short-lived local process, never into a file or a log. */
    static void keychainPut(String service, String account, String value) throws IOException {
        List<String> cmd = List.of(System.getProperty("idm.keychain.command", "security"), "add-generic-password", "-U", "-s", service, "-a", account, "-w", value);
        Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
        String out;
        try {
            out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            if (p.waitFor() != 0) {
                throw new IOException("the Keychain refused the item: " + out.replace(value, "•••").trim());
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("interrupted");
        }
    }

    /** For tests: the properties of a file, raw. */
    static Properties load(Path f) throws IOException {
        Properties p = new Properties();
        if (Files.isRegularFile(f)) {
            try (var r = Files.newBufferedReader(f, StandardCharsets.UTF_8)) {
                p.load(r);
            }
        }
        return p;
    }
}
