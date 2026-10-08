package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.ascode.AsCodeReader;
import com.pointblue.dirxml.dev.deploy.AgentWriteGate;
import com.pointblue.dirxml.dev.deploy.Deployer;
import com.pointblue.dirxml.dev.deploy.Environments;
import com.pointblue.dirxml.dev.deploy.ModelDiff;
import com.pointblue.dirxml.dev.deploy.Overrides;
import com.pointblue.dirxml.dev.deploy.Vault;
import com.pointblue.dirxml.dev.deploy.VaultDiff;
import com.pointblue.dirxml.dev.json.Json;
import com.pointblue.dirxml.dev.model.DriverSet;
import com.pointblue.dirxml.dev.operate.Operate;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import com.pointblue.dirxml.dev.deploy.SchemaOps;
import com.pointblue.dirxml.dev.model.Driver;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/**
 * The vault side of the workbench: which environments exist, the tree compared with one, a deploy
 * planned and run, the drivers' state and control, a driver's live trace. Each call is the core's
 * own function (the ones behind {@code vault.diff}, {@code vault.deploy}, {@code driverset.status},
 * {@code driver.start|stop|restart}, {@code driver.trace tail --ldap}) with its own short-lived
 * connection, resolved from the same environments file and credential sources the CLI uses.
 *
 * <p>Nothing here returns a secret: an environment is described by name, tier and what is
 * configured, never by value. Every write to a vault needs {@code confirm} to be the
 * environment's name, the CLI's {@code --confirm <env>}: the person types it.
 */
public final class VaultService {

    private final Path tree;

    public VaultService(Path tree) {
        this.tree = tree.toAbsolutePath().normalize();
    }

    private static Environments.Environment env(String name) throws IOException {
        if (name == null || name.isBlank()) {
            throw new TreeService.BadRequest("no environment named");
        }
        try {
            return Environments.load().get(name);
        } catch (IOException e) {
            throw new TreeService.BadRequest(e.getMessage());
        }
    }

    /** The environments file's environments, described without their values; or why there are none. */
    public Map<String, Object> environments() {
        Map<String, Object> m = new LinkedHashMap<>();
        List<Object> list = new ArrayList<>();
        try {
            Environments envs = Environments.load();
            m.put("file", envs.file().toString());
            for (Environments.Described d : envs.describe()) {
                Map<String, Object> e = new LinkedHashMap<>();
                e.put("name", d.name);
                e.put("tier", d.tier);
                e.put("ready", d.urlPresent && d.bindDnPresent && d.passwordConfigured && d.driverSetPresent);
                e.put("hasOverrides", java.nio.file.Files.isRegularFile(tree.resolve(Overrides.DIR).resolve(d.name + Overrides.EXT)));
                list.add(e);
            }
            m.put("available", true);
        } catch (IOException e) {
            m.put("available", false);
            m.put("why", e.getMessage());
        }
        m.put("environments", list);
        return m;
    }

    /** The tree against the environment's vault: the changes a deploy would make, and the overrides it applied. */
    public Map<String, Object> diff(String envName, List<String> drivers) throws IOException {
        Environments.Environment e = env(envName);
        ModelDiff diff;
        try {
            diff = VaultDiff.of(tree, e, drivers);
        } catch (IllegalArgumentException ex) {
            throw new TreeService.BadRequest(ex.getMessage());
        }
        Map<String, Object> m = new LinkedHashMap<>(Json.asMap(Json.parse(diff.json())));
        m.put("environment", e.name);
        m.put("tier", e.tier.name().toLowerCase());
        m.put("text", diff.text());
        m.put("overrides", overridesNote(e.name));
        return m;
    }

    private String overridesNote(String envName) throws IOException {
        DriverSet copy = AsCodeReader.read(tree);   // a throwaway read: apply mutates the model
        return Overrides.apply(copy, envName).summary();
    }

    /** What a deploy would do, step by step, with nothing written. */
    public Map<String, Object> plan(String envName, List<String> drivers, boolean restart, String secretsMode) throws IOException {
        Deployer.Options o = options(envName, drivers, restart, secretsMode);
        o.dryRun = true;
        return result(new Deployer(o).run(), o.env);
    }

    /** Run the deploy. {@code confirm} must be the environment's name. */
    public Map<String, Object> deploy(String envName, List<String> drivers, boolean restart, String secretsMode, String confirm) throws IOException {
        Deployer.Options o = options(envName, drivers, restart, secretsMode);
        String refusal = gate(o.env.name, confirm);
        if (refusal != null) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("ok", false);
            m.put("refusal", refusal);
            m.put("environment", o.env.name);
            return m;
        }
        o.yes = true;
        o.confirm = confirm;
        return result(new Deployer(o).run(), o.env);
    }

    private Deployer.Options options(String envName, List<String> drivers, boolean restart, String secretsMode) throws IOException {
        Deployer.Options o = new Deployer.Options();
        o.tree = tree;
        o.env = env(envName);
        o.drivers = drivers;
        o.restart = restart;
        o.secretsMode = secretsMode == null || secretsMode.isBlank() ? "none" : secretsMode;
        return o;
    }

    private static Map<String, Object> result(Deployer.Result r, Environments.Environment e) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", r.ok);
        m.put("environment", e.name);
        m.put("tier", e.tier.name().toLowerCase());
        m.put("refusal", r.refusal);
        m.put("failure", r.failure);
        m.put("plan", r.planText);
        m.put("diff", r.diffText);
        m.put("done", r.done);
        m.put("skipped", r.skipped);
        m.put("restarted", r.restarted);
        m.put("secretsSet", r.secretsSet);
        m.put("snapshot", r.snapshot);
        m.put("verified", r.verified);
        m.put("verify", r.verifyText);
        m.put("text", r.text());
        return m;
    }

    /**
     * The rule for any write to a vault from the page: the caller names the environment again,
     * exactly as the CLI's {@code --confirm <env>}. The agent switch ({@code IDM_AGENT_ALLOW_WRITE})
     * is deliberately not honoured here: a person at the page confirms each write.
     */
    static String gate(String envName, String confirm) {
        if (AgentWriteGate.refusal(envName, true, confirm, null) == null) {
            return null;
        }
        return "refusing to write to '" + envName + "': confirm by giving the environment's name";
    }

    // ---- schema (docs/schema.md in DirXMLDev): the vault's in the tree, the application's from the shim ----

    /** The tree's vault schema: counts and source, every class (name, LDAP, kind, custom) and every attribute (name, LDAP, syntax, single, custom). */
    public Map<String, Object> schema() throws IOException {
        DriverSet ds = AsCodeReader.read(tree);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("present", ds.schema != null);
        if (ds.schema == null) {
            return m;
        }
        m.putAll(ds.schema.summary());
        List<Object> classes = new ArrayList<>();
        for (com.pointblue.dirxml.dev.model.VaultSchema.ClassDef c : ds.schema.classes) {
            Map<String, Object> cm = new LinkedHashMap<>();
            cm.put("name", c.name);
            cm.put("ldap", c.ldap);
            cm.put("kind", c.kind);
            cm.put("container", c.container);
            cm.put("custom", c.custom);
            cm.put("superclasses", c.superclasses);
            classes.add(cm);
        }
        m.put("classes", classes);
        List<Object> attrs = new ArrayList<>();
        for (com.pointblue.dirxml.dev.model.VaultSchema.AttrDef a : ds.schema.attributes) {
            Map<String, Object> am = new LinkedHashMap<>();
            am.put("name", a.name);
            am.put("ldap", a.ldap);
            am.put("syntax", a.syntax);
            am.put("single", a.single);
            am.put("custom", a.custom);
            attrs.add(am);
        }
        m.put("attributes", attrs);
        return m;
    }

    /** One class with everything about it and the attributes it holds (its superclasses' included), for a picker. */
    public Map<String, Object> schemaClass(String name) throws IOException {
        DriverSet ds = AsCodeReader.read(tree);
        if (ds.schema == null) {
            throw new TreeService.NotFound("the tree has no schema");
        }
        com.pointblue.dirxml.dev.model.VaultSchema.ClassDef c = ds.schema.classDef(name);
        if (c == null) {
            throw new TreeService.NotFound("no class '" + name + "' in the schema");
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", c.name);
        m.put("ldap", c.ldap);
        m.put("oid", c.oid);
        m.put("kind", c.kind);
        m.put("container", c.container);
        m.put("custom", c.custom);
        m.put("superclasses", c.superclasses);
        m.put("mandatory", c.mandatory);
        m.put("optional", c.optional);
        m.put("containment", c.containment);
        m.put("naming", c.naming);
        Set<String> mandatory = new java.util.HashSet<>();
        mandatoryOf(ds.schema, c, mandatory, new java.util.HashSet<>());
        List<Object> all = new ArrayList<>();
        for (String a : ds.schema.attributesOf(c.name)) {
            com.pointblue.dirxml.dev.model.VaultSchema.AttrDef d = ds.schema.attribute(a);
            Map<String, Object> am = new LinkedHashMap<>();
            am.put("name", a);
            am.put("ldap", d == null ? a : d.ldap);
            am.put("syntax", d == null ? null : d.syntax);
            am.put("single", d != null && d.single);
            am.put("mandatory", mandatory.contains(a.toLowerCase(java.util.Locale.ROOT)));
            all.add(am);
        }
        m.put("attributes", all);
        return m;
    }

    /** The attributes a class must have, its superclasses' included (a mandatory attribute is mandatory wherever it is inherited). */
    private static void mandatoryOf(com.pointblue.dirxml.dev.model.VaultSchema s, com.pointblue.dirxml.dev.model.VaultSchema.ClassDef c, Set<String> out, Set<String> seen) {
        if (c == null || !seen.add(c.name.toLowerCase(java.util.Locale.ROOT))) {
            return;
        }
        for (String a : c.mandatory) {
            out.add(a.toLowerCase(java.util.Locale.ROOT));
        }
        for (String sup : c.superclasses) {
            mandatoryOf(s, s.classDef(sup), out, seen);
        }
    }

    /** A driver's application schema as the shim reported it: classes with their attributes; present=false when never read. */
    public Map<String, Object> appSchema(String driver) throws IOException {
        DriverSet ds = AsCodeReader.read(tree);
        Driver d = ds.driver(driver);
        if (d == null) {
            throw new TreeService.NotFound("no driver '" + driver + "'");
        }
        org.w3c.dom.Element app = d.config.get(Driver.APP_SCHEMA);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("driver", driver);
        m.put("present", app != null);
        List<Object> classes = new ArrayList<>();
        if (app != null) {
            m.put("hierarchical", app.getAttribute("hierarchical"));
            for (org.w3c.dom.Element c : SchemaOps.children(app, "class-def")) {
                Map<String, Object> cm = new LinkedHashMap<>();
                cm.put("name", c.getAttribute("class-name"));
                cm.put("container", "true".equals(c.getAttribute("container")));
                List<Object> attrs = new ArrayList<>();
                for (org.w3c.dom.Element a : SchemaOps.children(c, "attr-def")) {
                    Map<String, Object> am = new LinkedHashMap<>();
                    am.put("name", a.getAttribute("attr-name"));
                    am.put("type", a.getAttribute("type"));
                    am.put("multi", "true".equals(a.getAttribute("multi-valued")));
                    am.put("required", "true".equals(a.getAttribute("required")));
                    am.put("naming", "true".equals(a.getAttribute("naming")));
                    attrs.add(am);
                }
                cm.put("attributes", attrs);
                classes.add(cm);
            }
        }
        m.put("classes", classes);
        return m;
    }

    /** {@code vault.schema}: read the environment's schema into the tree (a vault read, a tree write). */
    public Map<String, Object> refreshSchema(String envName) throws IOException {
        return schemaResult(SchemaOps.refreshVault(tree, env(envName)));
    }

    /** {@code vault.app-schema}: ask the engine for the driver's application schema (the driver must be stopped). */
    public Map<String, Object> refreshAppSchema(String envName, String driver) throws IOException {
        return schemaResult(SchemaOps.refreshApp(tree, env(envName), driver));
    }

    /** {@code vault.deploy-schema}: the plan without {@code confirm}; with it (the environment's name) the push. */
    public Map<String, Object> deploySchema(String envName, String confirm) throws IOException {
        Environments.Environment e = env(envName);
        boolean write = confirm != null && !confirm.isBlank();
        if (write) {
            String refusal = gate(e.name, confirm);
            if (refusal != null) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("ok", false);
                m.put("refusal", refusal);
                return m;
            }
        }
        return schemaResult(SchemaOps.deploySchema(tree, e, write, confirm));
    }

    private static Map<String, Object> schemaResult(SchemaOps.Result r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", r.ok);
        m.put("refusal", r.refusal);
        m.putAll(r.summary);
        m.put("done", r.done);
        m.put("skipped", r.skipped);
        m.put("failures", r.failures);
        m.put("text", r.text());
        return m;
    }

    /** Every driver of the environment's driver set with its state and start option. */
    public Map<String, Object> status(String envName) throws IOException {
        Environments.Environment e = env(envName);
        try (Vault vault = Vault.connect(e.vaultConfig())) {
            Operate.Result r = Operate.driversetStatus(Operate.vaultEngine(vault), e);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("environment", e.name);
            m.put("ok", r.ok);
            m.put("drivers", Json.parse(r.json()));
            m.put("text", r.text());
            return m;
        }
    }

    /** Start, stop or restart a driver. {@code confirm} must be the environment's name. */
    public Map<String, Object> lifecycle(String envName, String driver, String action, String confirm) throws IOException {
        if (!List.of("start", "stop", "restart").contains(action)) {
            throw new TreeService.BadRequest("action is start, stop or restart");
        }
        if (driver == null || driver.isBlank()) {
            throw new TreeService.BadRequest("no driver named");
        }
        Environments.Environment e = env(envName);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("environment", e.name);
        m.put("driver", driver);
        m.put("action", action);
        String refusal = gate(e.name, confirm);
        if (refusal != null) {
            m.put("ok", false);
            m.put("text", refusal);
            return m;
        }
        try (Vault vault = Vault.connect(e.vaultConfig())) {
            Operate.Result r = Operate.lifecycle(Operate.vaultEngine(vault), e, driver, action, 60, true, confirm, tree);
            m.put("ok", r.ok);
            m.put("text", r.text());
            return m;
        }
    }

    /**
     * The servers the environment's driver set runs on, read from the vault ({@code DirXML-ServerList}),
     * each with the LDAP address the trace is read from (the environment's {@code servers=} mapping,
     * else derived from the server object), and which one the environment's own URL reaches.
     */
    public Map<String, Object> servers(String envName) throws IOException {
        Environments.Environment e = env(envName);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("environment", e.name);
        List<Object> out = new ArrayList<>();
        try (Vault vault = Vault.connect(e.vaultConfig())) {
            String primary = com.pointblue.dirxml.dev.deploy.Servers.primary(vault);
            for (String dn : com.pointblue.dirxml.dev.deploy.Servers.serverList(vault, e.driverSetDn)) {
                Map<String, Object> s = new LinkedHashMap<>();
                s.put("dn", dn);
                s.put("name", dn.replaceFirst("^[^=]+=", "").replaceFirst(",.*$", ""));
                String url = null;
                try {
                    url = com.pointblue.dirxml.dev.deploy.Servers.urlOf(e, vault, dn);
                } catch (RuntimeException ignore) {
                    // no address known: the trace of this server is not reachable from here
                }
                s.put("url", url);
                s.put("primary", primary != null && primary.equalsIgnoreCase(dn));
                out.add(s);
            }
            m.put("primary", primary);
        }
        m.put("servers", out);
        return m;
    }

    /** The simulator's case directory, for a cache saved as a case; set by the workspace once the simulator service exists. */
    private Path casesDir;

    public void setCasesDir(Path dir) {
        this.casesDir = dir;
    }

    /**
     * A driver's event cache through the core's {@code driver.cache view}: the queued events
     * (operation, class, DN, event id), the merged cache document, and a simulator-ready input
     * document built from them. A read; any signed-in user.
     */
    public Map<String, Object> cacheView(String envName, String driver, int count) throws IOException {
        if (driver == null || driver.isBlank()) {
            throw new TreeService.BadRequest("no driver named");
        }
        Environments.Environment e = env(envName);
        Path out = java.nio.file.Files.createTempDirectory("idmweb-cache");
        try (Vault vault = Vault.connect(e.vaultConfig())) {
            Operate.Result r = Operate.cacheView(Operate.vaultEngine(vault), e, driver, Math.max(1, Math.min(count, 1000)), out);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("environment", e.name);
            m.put("driver", driver);
            m.put("ok", r.ok);
            Object parsed = Json.parse(r.json);
            if (parsed instanceof Map) {
                Map<?, ?> pm = (Map<?, ?>) parsed;
                m.put("count", pm.get("count"));
                m.put("events", pm.get("events"));
            }
            m.put("text", r.text());
            Path input = out.resolve("input.xds");
            Path cache = out.resolve("cache.xds");
            m.put("inputXds", java.nio.file.Files.exists(input) ? java.nio.file.Files.readString(input) : null);
            m.put("cacheXds", java.nio.file.Files.exists(cache) ? java.nio.file.Files.readString(cache) : null);
            return m;
        } finally {
            deleteQuietly(out);
        }
    }

    /**
     * The cache's events as one simulator case: {@code input.xds} is the core's simulator-ready
     * document, {@code case.properties} names the driver and channel and where it came from.
     * {@code dryRun} returns the files without writing. Refused when the cache is empty.
     */
    public Map<String, Object> cacheCase(String envName, String driver, String name, String channel, boolean replace, boolean dryRun) throws IOException {
        Map<String, Object> view = cacheView(envName, driver, 1000);
        String input = (String) view.get("inputXds");
        Object count = view.get("count");
        Map<String, Object> m = new LinkedHashMap<>();
        if (!Boolean.TRUE.equals(view.get("ok")) || input == null || count == null || ((Number) count).intValue() == 0) {
            m.put("ok", false);
            m.put("refusal", "the cache of " + driver + " is empty; nothing to save");
            return m;
        }
        String caseName = name == null || name.isBlank() ? driver.replaceAll("[^A-Za-z0-9._-]+", "-") + "-cache-" + CACHE_STAMP.format(java.time.Instant.now()) : name.trim();
        if (!caseName.matches("[A-Za-z0-9][A-Za-z0-9._ -]{0,79}")) {
            throw new TreeService.BadRequest("a case name is a short file name (letters, digits, . _ - and spaces)");
        }
        String ch = "publisher".equalsIgnoreCase(channel) ? "publisher" : "subscriber";
        if (casesDir == null) {
            throw new IllegalStateException("no case directory");
        }
        Path dir = casesDir.resolve(caseName);
        boolean exists = java.nio.file.Files.exists(dir.resolve("case.properties"));
        if (exists && !replace) {
            m.put("ok", false);
            m.put("refusal", "case '" + caseName + "' exists at " + dir + " (tick replace to overwrite it)");
            return m;
        }
        Map<String, String> files = new LinkedHashMap<>();
        files.put("case.properties", "driver=" + driver + "\nchannel=" + ch + "\nsource=cache:" + envName + ":" + driver + "\nsourceTime=" + java.time.Instant.now() + "\nsourceEvents=" + count + "\n");
        files.put("input.xds", input.endsWith("\n") ? input : input + "\n");
        if (!dryRun) {
            java.nio.file.Files.createDirectories(dir);
            for (Map.Entry<String, String> f : files.entrySet()) {
                java.nio.file.Files.writeString(dir.resolve(f.getKey()), f.getValue(), java.nio.charset.StandardCharsets.UTF_8);
            }
        }
        m.put("ok", true);
        m.put("name", caseName);
        m.put("dir", dir.toString());
        m.put("files", files);
        m.put("replaced", exists);
        m.put("events", count);
        m.put("written", !dryRun);
        return m;
    }

    private static final java.time.format.DateTimeFormatter CACHE_STAMP = java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd-HHmm").withZone(java.time.ZoneId.systemDefault());

    /** Empties a driver's cache through the core's {@code driver.cache clear} (a snapshot first); gated like every vault write. */
    public Map<String, Object> cacheClear(String envName, String driver, String confirm) throws IOException {
        if (driver == null || driver.isBlank()) {
            throw new TreeService.BadRequest("no driver named");
        }
        Environments.Environment e = env(envName);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("environment", e.name);
        m.put("driver", driver);
        String refusal = gate(e.name, confirm);
        if (refusal != null) {
            m.put("ok", false);
            m.put("text", refusal);
            return m;
        }
        try (Vault vault = Vault.connect(e.vaultConfig())) {
            Operate.Result r = Operate.cacheClear(Operate.vaultEngine(vault), e, driver, true, confirm, tree);
            m.put("ok", r.ok);
            m.put("text", r.text());
            return m;
        }
    }

    private static void deleteQuietly(Path dir) {
        try (java.util.stream.Stream<Path> s = java.nio.file.Files.walk(dir)) {
            s.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                try {
                    java.nio.file.Files.deleteIfExists(p);
                } catch (IOException ignored) {
                    // a temp directory
                }
            });
        } catch (IOException ignored) {
            // a temp directory
        }
    }

    /**
     * Live trace as parsed records (see {@link TraceService#json}), until the calling thread is
     * interrupted: from every server of the driver set at its own LDAP address (each keeps its own
     * trace), or from {@code serverDn} alone. {@code driver} null = every driver.
     */
    @SuppressWarnings("unchecked")
    public void trace(String envName, String driver, boolean engineToo, String serverDn, Consumer<Map<String, Object>> sink) throws Exception {
        Environments.Environment e = env(envName);
        List<TraceService.Source> sources = new ArrayList<>();
        List<Map<String, Object>> servers = (List<Map<String, Object>>) servers(envName).get("servers");
        for (Map<String, Object> s : servers) {
            String dn = String.valueOf(s.get("dn"));
            if (serverDn != null && !serverDn.isBlank() && !serverDn.equalsIgnoreCase(dn)) {
                continue;
            }
            // the environment's own server is reached at the environment's URL (a tunnel, a name that
            // resolves from here); the address derived from the server object is for the other servers
            String url = Boolean.TRUE.equals(s.get("primary")) ? e.url : (s.get("url") == null ? null : String.valueOf(s.get("url")));
            if (url == null || url.isBlank()) {
                continue;
            }
            sources.add(new TraceService.Source(String.valueOf(s.get("name")), url));
        }
        if (sources.isEmpty()) {
            if (serverDn != null && !serverDn.isBlank()) {
                throw new TreeService.BadRequest("no LDAP address is known for " + serverDn + "; name one in the environment's servers= setting (dn=url;…)");
            }
            sources.add(new TraceService.Source(e.name, e.url));
        }
        TraceService.stream(e, sources, driver, engineToo, sink);
    }

    /**
     * Sets a driver's trace level ({@code DirXML-TraceLevel}, 0–10) through the core's
     * {@code driver.trace set}: on the environment's server, or on {@code serverDn}'s own address
     * since the level is kept per server. Gated like every vault write.
     */
    public Map<String, Object> traceLevel(String envName, String driver, int level, String serverDn, String confirm) throws IOException {
        if (driver == null || driver.isBlank()) {
            throw new TreeService.BadRequest("no driver named");
        }
        if (level < 0 || level > 10) {
            throw new TreeService.BadRequest("the trace level is 0 to 10");
        }
        Environments.Environment e = env(envName);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("environment", e.name);
        m.put("driver", driver);
        m.put("level", level);
        String refusal = gate(e.name, confirm);
        if (refusal != null) {
            m.put("ok", false);
            m.put("text", refusal);
            return m;
        }
        Vault.Config cfg = e.vaultConfig();
        if (serverDn != null && !serverDn.isBlank()) {
            String url;
            try (Vault vault = Vault.connect(cfg)) {
                url = com.pointblue.dirxml.dev.deploy.Servers.urlOf(e, vault, serverDn);
            }
            if (url == null || url.isBlank()) {
                throw new TreeService.BadRequest("no LDAP address is known for " + serverDn);
            }
            cfg = cfg.withUrl(url);
            m.put("server", serverDn);
        }
        try (Vault vault = Vault.connect(cfg)) {
            Operate.Result r = Operate.traceSet(Operate.vaultEngine(vault), e, driver, level, null, true, confirm, tree);
            m.put("ok", r.ok);
            m.put("text", r.text());
            return m;
        }
    }
}
