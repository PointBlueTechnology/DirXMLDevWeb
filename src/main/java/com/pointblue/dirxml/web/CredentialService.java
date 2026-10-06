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
    private static final List<String> FIELDS = List.of("url", "bindDn", "driverSet", "tier", "trustAll", "requires", "sshHost", "sshUser", "secrets");
    private static final String KEYCHAIN_PREFIX = "idm-";

    private final Path tree;

    public CredentialService(Path tree) {
        this.tree = tree.toAbsolutePath().normalize();
    }

    /** The environments file the CLI would read, or the one it would create. */
    static Path environmentsFile() {
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

    static boolean keychainAvailable() {
        return System.getProperty("os.name", "").toLowerCase().contains("mac");
    }

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
        m.put("keychain", keychainAvailable());
        List<Object> envs = new ArrayList<>();
        if (Files.isRegularFile(f)) {
            Map<String, String> props = new PropertiesFile(f).entries();
            List<String> names = new ArrayList<>();
            for (String k : props.keySet()) {
                int dot = k.indexOf('.');
                if (dot > 0 && !names.contains(k.substring(0, dot))) {
                    names.add(k.substring(0, dot));
                }
            }
            for (String n : names) {
                Map<String, Object> e = new LinkedHashMap<>();
                e.put("name", n);
                for (String field : FIELDS) {
                    e.put(field, props.get(n + "." + field));
                }
                e.put("password", sourceKind(props, n + ".password"));
                e.put("secretsFile", secretsFile(f, props, n).toString());
                e.put("secretsFileExists", Files.isRegularFile(secretsFile(f, props, n)));
                boolean ready = props.get(n + ".url") != null && props.get(n + ".bindDn") != null && props.get(n + ".driverSet") != null && sourceKind(props, n + ".password") != null;
                e.put("ready", ready);
                envs.add(e);
            }
        }
        m.put("environments", envs);
        return m;
    }

    private static Path secretsFile(Path envFile, Map<String, String> props, String env) {
        String s = props.get(env + ".secrets");
        Path dir = envFile.getParent() == null ? Paths.get(".") : envFile.getParent();
        return s == null || s.isBlank() ? dir.resolve("secrets-" + env + ".properties") : dir.resolve(s.trim()).normalize();
    }

    /** Try the parameters as given (the password typed, or the environment's configured one); nothing is saved. */
    public Map<String, Object> test(Map<String, Object> req) throws IOException {
        Vault.Config c = new Vault.Config();
        c.url = Json.asString(req.get("url"));
        c.bindDn = Json.asString(req.get("bindDn"));
        c.trustAll = Boolean.TRUE.equals(req.get("trustAll"));
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
                c.password = Environments.load().get(nameOk(env)).password;
            } catch (IOException e) {
                m.put("ok", false);
                m.put("message", e.getMessage());
                return m;
            }
        } else {
            c.password = password;
        }
        try (Vault v = Vault.connect(c)) {
            m.put("ok", true);
            if (driverSet != null && !driverSet.isBlank()) {
                boolean there = v.exists(driverSet);
                m.put("driverSetFound", there);
                m.put("message", there ? "Connected; the driver set is there." : "Connected, but no object at " + driverSet + ".");
            } else {
                m.put("message", "Connected.");
            }
        } catch (RuntimeException e) {
            m.put("ok", false);
            m.put("message", scrub(e.getMessage() == null ? e.toString() : e.getMessage(), c.password));
        }
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
        Path f = environmentsFile();
        PropertiesFile pf = new PropertiesFile(f);
        for (String field : FIELDS) {
            if (req.containsKey(field)) {
                Object v = req.get(field);
                String s = v == null ? null : String.valueOf(v).trim();
                pf.set(name + "." + field, s == null || s.isEmpty() || "false".equals(s) && field.equals("trustAll") ? null : s);
            }
        }
        String store = Json.asString(req.get("passwordStore"));
        String password = Json.asString(req.get("password"));
        List<String> notes = new ArrayList<>();
        if (store != null && !store.isBlank()) {
            if (store.equals("keychain") || store.equals("file")) {
                if (password == null || password.isEmpty()) {
                    throw new TreeService.BadRequest("no password given");
                }
            }
            clearPassword(pf, name);
            if (store.equals("keychain")) {
                if (!keychainAvailable()) {
                    throw new TreeService.BadRequest("the Keychain is macOS only; store the password in the file, an environment variable or a command");
                }
                String service = KEYCHAIN_PREFIX + name;
                String account = pf.entries().getOrDefault(name + ".bindDn", "vault");
                keychainPut(service, account, password);
                pf.set(name + ".passwordKeychain", service + "/" + account);
                notes.add("password stored in the Keychain as " + service + " / " + account);
            } else if (store.equals("file")) {
                pf.set(name + ".password", password);
                notes.add("password stored as a literal in " + f + " (owner-only)");
            } else if (store.startsWith("env:")) {
                pf.set(name + ".passwordEnv", store.substring(4).trim());
            } else if (store.startsWith("command:")) {
                pf.set(name + ".passwordCommand", store.substring(8).trim());
            } else {
                throw new TreeService.BadRequest("passwordStore is keychain, file, env:VAR or command:…");
            }
        }
        pf.save();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("file", f.toString());
        m.put("notes", notes);
        return m;
    }

    private static void clearPassword(PropertiesFile pf, String name) {
        pf.remove(name + ".password");
        for (String form : SecretSource.FORMS) {
            pf.remove(name + ".password" + form);
        }
    }

    /** Remove an environment's lines; its secrets file and Keychain items stay. */
    public Map<String, Object> remove(String name) throws IOException {
        nameOk(name);
        Path f = environmentsFile();
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
        Path f = environmentsFile();
        Map<String, String> props = Files.isRegularFile(f) ? new PropertiesFile(f).entries() : Map.of();
        Path sf = secretsFile(f, props, env);
        Map<String, String> configured = Files.isRegularFile(sf) ? new PropertiesFile(sf, true).entries() : Map.of();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("environment", env);
        m.put("file", sf.toString());
        m.put("exists", Files.isRegularFile(sf));
        List<Object> needs = new ArrayList<>();
        List<String> seen = new ArrayList<>();
        DriverSet ds = AsCodeReader.read(tree);
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
        Path f = environmentsFile();
        PropertiesFile envs = new PropertiesFile(f);
        Path sf = secretsFile(f, envs.entries(), env);
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
