package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.ascode.AsCodeReader;
import com.pointblue.dirxml.dev.ascode.AsCodeWriter;
import com.pointblue.dirxml.dev.edit.Fishbone;
import com.pointblue.dirxml.dev.edit.Operation;
import com.pointblue.dirxml.dev.edit.Refs;
import com.pointblue.dirxml.dev.edit.Registry;
import com.pointblue.dirxml.dev.edit.Result;
import com.pointblue.dirxml.dev.edit.Transaction;
import com.pointblue.dirxml.dev.json.Json;
import com.pointblue.dirxml.dev.model.Artifact;
import com.pointblue.dirxml.dev.model.Driver;
import com.pointblue.dirxml.dev.model.DriverSet;
import com.pointblue.dirxml.dev.model.Entitlement;
import com.pointblue.dirxml.dev.model.Form;
import com.pointblue.dirxml.dev.model.Policy;
import com.pointblue.dirxml.dev.model.Prd;
import com.pointblue.dirxml.dev.model.Resource;
import com.pointblue.dirxml.dev.validate.Validator;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The tree, as the page needs it: the outline, an artifact with its source and references, a
 * driver's policy flow, the validation report, the operation catalog, and running an operation.
 * Everything is the DirXMLDev core called in process; nothing here re-implements it. The tree on
 * disk is the only state: the model is re-read whenever the revision moves.
 */
public final class TreeService {

    /** A request that names something the tree does not have. */
    public static final class NotFound extends RuntimeException {
        public NotFound(String m) {
            super(m);
        }
    }

    /** A write planned against a tree that has since changed. */
    public static final class Stale extends RuntimeException {
        public Stale(String m) {
            super(m);
        }
    }

    /** A request the caller got wrong. */
    public static final class BadRequest extends RuntimeException {
        public BadRequest(String m) {
            super(m);
        }
    }

    static final long MAX_FILE = 5L * 1024 * 1024;

    private final Path tree;
    private final Watcher watcher;
    private DriverSet cached;
    private String cachedRevision;

    private String catalogArg;

    /** The catalog directory package operations take when the page gives none. */
    public void catalog(String dir) {
        this.catalogArg = dir;
    }

    public TreeService(Path tree, Watcher watcher) {
        this.tree = tree.toAbsolutePath().normalize();
        this.watcher = watcher;
    }

    public Path tree() {
        return tree;
    }

    private synchronized DriverSet model() throws IOException {
        String rev = watcher.revision();
        if (cached == null || !rev.equals(cachedRevision)) {
            cached = AsCodeReader.read(tree);
            cachedRevision = rev;
        }
        return cached;
    }

    // ---- reads ----

    public synchronized Map<String, Object> outline() throws IOException {
        DriverSet ds = model();
        Map<String, String> files = AsCodeWriter.files(ds);
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("revision", cachedRevision);
        o.put("tree", tree.toString());
        Map<String, Object> set = new LinkedHashMap<>();
        set.put("name", ds.name);
        set.put("dn", ds.dn);
        set.put("config", existing(List.of("config-values.xml")));
        // the driver set's own record: its servers, its linkage of driver-set-level objects, its package stamps
        List<Object> servers = new ArrayList<>();
        String primary = ds.meta.get("servers.primary");
        for (String s : ds.servers) {
            Map<String, Object> sv = new LinkedHashMap<>();
            sv.put("dn", s);
            sv.put("name", s.replaceFirst("^[^=]+=", "").replaceFirst(",.*$", ""));
            sv.put("primary", s.equalsIgnoreCase(primary));
            servers.add(sv);
        }
        set.put("servers", servers);
        List<Object> linkage = new ArrayList<>();
        Map<String, String> packages = new java.util.TreeMap<>();
        Map<String, String> meta = new java.util.TreeMap<>();
        for (Map.Entry<String, String> e : ds.meta.entrySet()) {
            if (e.getKey().startsWith("driverset.linkage.")) {
                String[] p = e.getValue().split("#");
                Map<String, Object> l = new LinkedHashMap<>();
                l.put("dn", p[0]);
                l.put("name", p[0].replaceFirst("^[^=]+=", "").replaceFirst(",.*$", ""));
                l.put("order", p.length > 1 ? p[1] : null);
                l.put("type", p.length > 2 ? p[2] : null);
                linkage.add(l);
            } else if (e.getKey().startsWith("package.installed.")) {
                packages.put(e.getKey().substring("package.installed.".length()), e.getValue());
            } else if (!e.getKey().equals("objectClass") && !e.getKey().equals("servers.primary")) {
                meta.put(e.getKey(), e.getValue());
            }
        }
        set.put("linkage", linkage);
        set.put("packages", packages);
        set.put("meta", meta);
        set.put("libraryItems", ds.library.policies.size() + ds.library.resources.size());
        set.put("schema", ds.schema == null ? null : ds.schema.summary());
        o.put("driverSet", set);
        Map<String, Object> lib = new LinkedHashMap<>();
        lib.put("policies", nodes(ds.library.policies, files));
        lib.put("resources", nodes(ds.library.resources, files));
        o.put("library", lib);
        List<Object> drivers = new ArrayList<>();
        for (Driver d : ds.drivers) {
            String dir = "drivers/" + AsCodeWriter.fileSafe(d.name);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", d.name);
            m.put("dn", d.dn);
            m.put("shimClass", d.shimClass);
            m.put("dir", dir);
            List<String> config = new ArrayList<>();
            for (String kind : d.config.keySet()) {
                config.add(dir + "/" + kind + ".xml");
            }
            m.put("config", existing(config));
            Map<String, Object> policies = new LinkedHashMap<>();
            policies.put("driver", nodes(d.policies, files));
            policies.put("subscriber", nodes(d.subscriber.policies, files));
            policies.put("publisher", nodes(d.publisher.policies, files));
            m.put("policies", policies);
            m.put("resources", nodes(d.resources, files));
            List<Object> ents = new ArrayList<>();
            for (Entitlement e : d.entitlements) {
                ents.add(fileNode(e.name, dir + "/entitlements/" + AsCodeWriter.fileSafe(e.name) + ".xml"));
            }
            m.put("entitlements", ents);
            List<Object> forms = new ArrayList<>();
            List<Object> prds = new ArrayList<>();
            if (d.provisioning != null) {
                for (Form f : d.provisioning.forms) {
                    Map<String, Object> n = fileNode(f.name, dir + "/provisioning/forms/" + f.kind.dir + "/" + AsCodeWriter.fileSafe(f.name) + ".form.json");
                    n.put("kind", f.kind.dir);
                    forms.add(n);
                }
                for (Prd p : d.provisioning.prds) {
                    String base = dir + "/provisioning/prds/" + AsCodeWriter.fileSafe(p.name);
                    Map<String, Object> n = new LinkedHashMap<>();
                    n.put("name", p.name);
                    n.put("files", existing(List.of(base + "/definition.xml", base + "/request.xml", base + "/process.xml")));
                    prds.add(n);
                }
            }
            m.put("forms", forms);
            m.put("prds", prds);
            drivers.add(m);
        }
        o.put("drivers", drivers);
        return o;
    }

    private List<Object> nodes(List<? extends Artifact> artifacts, Map<String, String> files) {
        List<Object> out = new ArrayList<>();
        for (Artifact a : artifacts) {
            Map<String, Object> n = new LinkedHashMap<>();
            n.put("path", a.path());
            n.put("name", a.name);
            n.put("kind", kindOf(a));
            n.put("file", files.get(a.path()));
            out.add(n);
        }
        return out;
    }

    private static String kindOf(Artifact a) {
        if (a instanceof Policy) {
            return ((Policy) a).policyKind().name().toLowerCase().replace('_', '-');
        }
        if (a instanceof Resource) {
            Resource r = (Resource) a;
            return r.isMappingTable() ? "mapping-table" : r.isEcmaScript() ? "ecmascript" : r.isGcvDef() ? "gcv" : a.kind();
        }
        return a.kind();
    }

    private Map<String, Object> fileNode(String name, String file) {
        Map<String, Object> n = new LinkedHashMap<>();
        n.put("name", name);
        n.put("file", Files.isRegularFile(tree.resolve(file)) ? file : null);
        return n;
    }

    private List<String> existing(List<String> files) {
        List<String> out = new ArrayList<>();
        for (String f : files) {
            if (Files.isRegularFile(tree.resolve(f))) {
                out.add(f);
            }
        }
        return out;
    }

    /** An artifact (policy or resource): where it lives, its source, and what refers to it. */
    public synchronized Map<String, Object> artifact(String path) throws IOException {
        DriverSet ds = model();
        Artifact a = ds.index().get(path);
        if (a == null) {
            throw new NotFound("no artifact '" + path + "' in the tree");
        }
        String file = AsCodeWriter.files(ds).get(path);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("revision", cachedRevision);
        m.put("path", a.path());
        m.put("name", a.name);
        m.put("kind", kindOf(a));
        m.put("scope", a.scope.name().toLowerCase());
        m.put("driver", a.driver);
        m.put("file", file);
        m.put("language", language(file));
        m.put("content", file == null ? "" : Files.readString(tree.resolve(file), StandardCharsets.UTF_8));
        m.put("editable", file != null);
        m.put("packaged", a.meta.keySet().stream().anyMatch(k -> k.toLowerCase().startsWith("dirxml-pkg") || k.equals("package-id")));
        List<Object> refs = new ArrayList<>();
        for (Refs.Ref r : Refs.to(ds, path)) {
            Map<String, Object> rm = new LinkedHashMap<>();
            rm.put("kind", r.kind);
            rm.put("from", r.from);
            rm.put("detail", r.detail);
            refs.add(rm);
        }
        m.put("refs", refs);
        return m;
    }

    /** Any file of the tree, read-only (configuration, entitlements, forms, PRD parts). */
    public synchronized Map<String, Object> file(String relative) throws IOException {
        Path f = inside(relative);
        if (!Files.isRegularFile(f)) {
            throw new NotFound("no file '" + relative + "' in the tree");
        }
        if (Files.size(f) > MAX_FILE) {
            throw new BadRequest("'" + relative + "' is larger than " + (MAX_FILE / 1024 / 1024) + " MB");
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("revision", watcher.revision());
        m.put("file", relative);
        m.put("language", language(relative));
        m.put("content", Files.readString(f, StandardCharsets.UTF_8));
        return m;
    }

    private Path inside(String relative) {
        if (relative == null || relative.isBlank()) {
            throw new BadRequest("no file named");
        }
        Path f = tree.resolve(relative).normalize();
        if (!f.startsWith(tree) || f.equals(tree)) {
            throw new BadRequest("'" + relative + "' is outside the tree");
        }
        for (Path part : tree.relativize(f)) {
            if (Watcher.SKIP.contains(part.toString())) {
                throw new BadRequest("'" + relative + "' is not part of the tree's content");
            }
        }
        return f;
    }

    static String language(String file) {
        if (file == null) {
            return "plaintext";
        }
        String f = file.toLowerCase();
        return f.endsWith(".xml") ? "xml" : f.endsWith(".json") ? "json" : f.endsWith(".js") ? "javascript"
            : f.endsWith(".properties") ? "ini" : f.endsWith(".md") ? "markdown" : "plaintext";
    }

    /**
     * The driver set as Designer's Modeler draws it (#32, docs/architecture-view.md): the set with
     * its servers and counts, and one application per driver — its Designer application type and
     * display name, whether it serves the vault itself, whether it carries an icon, its counts.
     */
    public synchronized Map<String, Object> architecture() throws IOException {
        DriverSet ds = model();
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("revision", cachedRevision);
        Map<String, Object> set = new LinkedHashMap<>();
        set.put("name", ds.name);
        set.put("dn", ds.dn);
        List<Object> servers = new ArrayList<>();
        String primary = ds.meta.get("servers.primary");
        for (String s : ds.servers) {
            Map<String, Object> sv = new LinkedHashMap<>();
            sv.put("dn", s);
            sv.put("name", s.replaceFirst("^[^=]+=", "").replaceFirst(",.*$", ""));
            sv.put("primary", s.equalsIgnoreCase(primary));
            servers.add(sv);
        }
        set.put("servers", servers);
        set.put("drivers", ds.drivers.size());
        set.put("libraryItems", ds.library.policies.size() + ds.library.resources.size());
        int packages = 0;
        for (String k : ds.meta.keySet()) {
            if (k.startsWith("package.installed.")) {
                packages++;
            }
        }
        set.put("packages", packages);
        o.put("driverSet", set);
        List<Object> apps = new ArrayList<>();
        for (Driver d : ds.drivers) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("driver", d.name);
            m.put("dn", d.dn);
            m.put("shimClass", d.shimClass);
            String type = com.pointblue.dirxml.dev.source.ApplicationType.of(d);
            m.put("type", type);
            m.put("typeName", com.pointblue.dirxml.dev.source.ApplicationType.displayName(type));
            m.put("vaultOnly", com.pointblue.dirxml.dev.source.ApplicationType.vaultOnly(type));
            m.put("icon", d.icon != null && d.icon.length > 0);
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("policies", d.policies.size() + d.subscriber.policies.size() + d.publisher.policies.size());
            c.put("subscriber", d.subscriber.policies.size());
            c.put("publisher", d.publisher.policies.size());
            c.put("driver", d.policies.size());
            c.put("entitlements", d.entitlements.size());
            c.put("resources", d.resources.size());
            c.put("forms", d.provisioning == null ? 0 : d.provisioning.forms.size());
            c.put("prds", d.provisioning == null ? 0 : d.provisioning.prds.size());
            m.put("counts", c);
            apps.add(m);
        }
        o.put("applications", apps);
        return o;
    }

    /**
     * The whole driver set as one tree, the way Designer's outline reads in the Developer
     * perspective (#32 A2, docs/architecture-view.md §3): the set's configuration and library,
     * then each driver's configuration, channels with their policy sets in engine order and
     * policies in linkage order (the fishbone's model), resources, entitlements, forms, PRDs.
     * Every node says what the page opens when clicked.
     */
    public synchronized Map<String, Object> developer() throws IOException {
        DriverSet ds = model();
        Map<String, String> files = AsCodeWriter.files(ds);
        Map<String, Object> root = node("set", ds.name, "driverset", sel("driverset"));
        List<Object> rootKids = kids(root);
        // the set's own configuration
        Map<String, Object> setConf = node("set-config", "Configuration", "folder", sel("config", "driver", null));
        List<Object> sc = kids(setConf);
        for (String f : existing(List.of("config-values.xml"))) {
            sc.add(leaf("set-file:" + f, "Global configuration values", "gcv", sel("config", "driver", null)));
        }
        sc.add(leaf("set-schema", "Vault schema", "schema", Map.of("type", "driverset", "tab", "schema")));
        sc.add(leaf("set-overrides", "Environment overrides", "overrides", sel("overrides")));
        rootKids.add(setConf);
        // the library
        Map<String, Object> lib = node("library", "Library", "folder", null);
        List<Object> lk = kids(lib);
        for (Object n : nodes(ds.library.policies, files)) {
            lk.add(artifactLeaf("lib", n));
        }
        for (Object n : nodes(ds.library.resources, files)) {
            lk.add(artifactLeaf("lib", n));
        }
        rootKids.add(lib);
        // the drivers
        Map<String, Object> drivers = node("drivers", "Drivers", "folder", null);
        List<Object> dk = kids(drivers);
        for (Driver d : ds.drivers) {
            String dir = "drivers/" + AsCodeWriter.fileSafe(d.name);
            String type = com.pointblue.dirxml.dev.source.ApplicationType.of(d);
            Map<String, Object> dn = node("driver:" + d.name, d.name, "driver", sel("flow", "driver", d.name));
            dn.put("driver", d.name);
            dn.put("typeName", com.pointblue.dirxml.dev.source.ApplicationType.displayName(type));
            dn.put("shimClass", d.shimClass);
            dn.put("icon", d.icon != null && d.icon.length > 0);
            List<Object> dkids = kids(dn);
            Map<String, Object> fb = Fishbone.model(ds, tree, d);
            // configuration
            Map<String, Object> conf = node("driver-config:" + d.name, "Configuration", "folder", sel("config", "driver", d.name));
            List<Object> ck = kids(conf);
            ck.add(leaf("driver-xml:" + d.name, "driver.xml", "file", Map.of("type", "file", "file", dir + "/driver.xml")));
            @SuppressWarnings("unchecked") Map<String, Object> filter = (Map<String, Object>) fb.get("filter");
            if (filter != null) {
                ck.add(leaf("filter:" + d.name, "Filter", "filter", sel("config", "driver", d.name)));
            }
            for (String kind : d.config.keySet()) {
                ck.add(leaf("cfg:" + d.name + ":" + kind, configLabel(kind), "config", sel("config", "driver", d.name)));
            }
            dkids.add(conf);
            // channels
            dkids.add(channel("subscriber", "Subscriber", d.name, fb, List.of("subscriber"), List.of("output")));
            dkids.add(channel("publisher", "Publisher", d.name, fb, List.of("publisher"), List.of("input")));
            Map<String, Object> mapping = bonesOf(fb, "spine", b -> "schema-mapping".equals(b.get("key")));
            if (mapping != null) {
                dkids.add(boneNode(d.name, mapping));
            }
            // resources: the fishbone's driver-level sets and the resource artifacts
            Map<String, Object> res = node("resources:" + d.name, "Resources", "folder", null);
            List<Object> rk = kids(res);
            for (Object o : (List<?>) fb.getOrDefault("resources", List.of())) {
                @SuppressWarnings("unchecked") Map<String, Object> b = (Map<String, Object>) o;
                if (!((List<?>) b.get("policies")).isEmpty()) {
                    rk.add(boneNode(d.name, b));
                }
            }
            for (Object n : nodes(d.resources, files)) {
                rk.add(artifactLeaf("res:" + d.name, n));
            }
            dkids.add(res);
            // entitlements, forms, PRDs
            if (!d.entitlements.isEmpty()) {
                Map<String, Object> ents = node("ents:" + d.name, "Entitlements", "folder", null);
                List<Object> ek = kids(ents);
                for (Entitlement e : d.entitlements) {
                    String f = dir + "/entitlements/" + AsCodeWriter.fileSafe(e.name) + ".xml";
                    ek.add(leaf("ent:" + d.name + ":" + e.name, e.name, "entitlement", Map.of("type", "entitlement", "driver", d.name, "name", e.name, "file", f)));
                }
                dkids.add(ents);
            }
            if (d.provisioning != null && !d.provisioning.forms.isEmpty()) {
                Map<String, Object> forms = node("forms:" + d.name, "Forms", "folder", null);
                List<Object> fk = kids(forms);
                for (Form f : d.provisioning.forms) {
                    fk.add(leaf("form:" + d.name + ":" + f.name, f.name, "form", Map.of("type", "form", "driver", d.name, "name", f.name)));
                }
                dkids.add(forms);
            }
            if (d.provisioning != null && !d.provisioning.prds.isEmpty()) {
                Map<String, Object> prds = node("prds:" + d.name, "Provisioning request definitions", "folder", null);
                List<Object> pk = kids(prds);
                for (Prd p : d.provisioning.prds) {
                    pk.add(leaf("prd:" + d.name + ":" + p.name, p.name, "prd", Map.of("type", "prd", "driver", d.name, "name", p.name)));
                }
                dkids.add(prds);
            }
            dk.add(dn);
        }
        rootKids.add(drivers);
        count(root);
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("revision", cachedRevision);
        o.put("root", root);
        return o;
    }

    private static Map<String, Object> channel(String key, String label, String driver, Map<String, Object> fb, List<String> boneLists, List<String> spineKeys) {
        Map<String, Object> ch = node(key + ":" + driver, label, "channel", null);
        List<Object> ck = kids(ch);
        for (String list : boneLists) {
            for (Object o : (List<?>) fb.getOrDefault(list, List.of())) {
                @SuppressWarnings("unchecked") Map<String, Object> b = (Map<String, Object>) o;
                ck.add(boneNode(driver, b));
            }
        }
        for (String sk : spineKeys) {
            Map<String, Object> b = bonesOf(fb, "spine", x -> sk.equals(x.get("key")));
            if (b != null) {
                ck.add(boneNode(driver, b));
            }
        }
        return ch;
    }

    private static Map<String, Object> bonesOf(Map<String, Object> fb, String list, java.util.function.Predicate<Map<String, Object>> which) {
        for (Object o : (List<?>) fb.getOrDefault(list, List.of())) {
            @SuppressWarnings("unchecked") Map<String, Object> b = (Map<String, Object>) o;
            if (which.test(b)) {
                return b;
            }
        }
        return null;
    }

    /** A policy set as a node with its policies in linkage order. */
    private static Map<String, Object> boneNode(String driver, Map<String, Object> bone) {
        Map<String, Object> n = node("bone:" + driver + ":" + bone.get("key"), String.valueOf(bone.get("label")), "policyset", null);
        List<Object> k = kids(n);
        for (Object o : (List<?>) bone.getOrDefault("policies", List.of())) {
            @SuppressWarnings("unchecked") Map<String, Object> p = (Map<String, Object>) o;
            Map<String, Object> leaf = leaf("policy:" + driver + ":" + bone.get("key") + ":" + p.get("id"), String.valueOf(p.get("name")), String.valueOf(p.getOrDefault("kind", "policy")), p.get("ref") == null ? null : Map.of("type", "artifact", "path", String.valueOf(p.get("ref"))));
            leaf.put("unresolved", Boolean.TRUE.equals(p.get("unresolved")));
            k.add(leaf);
        }
        return n;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> artifactLeaf(String prefix, Object nodeMap) {
        Map<String, Object> n = (Map<String, Object>) nodeMap;
        return leaf(prefix + ":" + n.get("path"), String.valueOf(n.get("name")), String.valueOf(n.get("kind")), Map.of("type", "artifact", "path", String.valueOf(n.get("path"))));
    }

    private static String configLabel(String kind) {
        switch (kind) {
            case "driver-filter": return "Filter";
            case "shim-config-info": return "Shim settings";
            case "engine-control-values": return "Engine control values";
            case "config-values": return "Global configuration values";
            case "app-schema": return "Application schema";
            default: return kind;
        }
    }

    private static Map<String, Object> sel(String type, Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", type);
        for (int i = 0; i + 1 < kv.length; i += 2) {
            m.put(String.valueOf(kv[i]), kv[i + 1]);
        }
        return m;
    }

    private static Map<String, Object> node(String id, String label, String kind, Map<String, Object> select) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("label", label);
        m.put("kind", kind);
        if (select != null) {
            m.put("select", select);
        }
        m.put("children", new ArrayList<>());
        return m;
    }

    private static Map<String, Object> leaf(String id, String label, String kind, Map<String, Object> select) {
        Map<String, Object> m = node(id, label, kind, select);
        m.remove("children");
        return m;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> kids(Map<String, Object> node) {
        return (List<Object>) node.get("children");
    }

    /** Each folder's count: the leaves beneath it. */
    @SuppressWarnings("unchecked")
    private static int count(Map<String, Object> n) {
        List<Object> c = (List<Object>) n.get("children");
        if (c == null) {
            return 1;
        }
        int total = 0;
        for (Object o : c) {
            total += count((Map<String, Object>) o);
        }
        n.put("count", total);
        return total;
    }

    /** A driver's icon bytes and format, or null when it has none. */
    public synchronized Map.Entry<String, byte[]> driverIcon(String driver) throws IOException {
        DriverSet ds = model();
        Driver d = ds.driver(driver);
        if (d == null) {
            throw new NotFound("no driver '" + driver + "' in the tree");
        }
        if (d.icon == null || d.icon.length == 0) {
            return null;
        }
        String ext = d.iconExtension != null ? d.iconExtension : Driver.iconExtensionOf(d.icon);
        return Map.entry(ext, d.icon);
    }

    public synchronized Map<String, Object> fishbone(String driver) throws IOException {
        DriverSet ds = model();
        Driver d = ds.driver(driver);
        if (d == null) {
            throw new NotFound("no driver '" + driver + "' in the tree");
        }
        Map<String, Object> m = Fishbone.model(ds, tree, d);
        m.put("revision", cachedRevision);
        return m;
    }

    public synchronized Map<String, Object> validation() throws IOException {
        DriverSet ds = model();
        Map<String, Object> m = new LinkedHashMap<>(Json.asMap(Json.parse(Validator.standard().validate(ds).json())));
        m.put("revision", cachedRevision);
        return m;
    }

    // ---- the operation catalog, and running one ----

    /** Every edit operation the core registers: its name, what it does and the arguments it takes. */
    public static List<Object> catalog() {
        List<Object> out = new ArrayList<>();
        for (Registry.Spec s : Registry.all()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", s.name);
            m.put("help", s.help);
            List<Object> args = new ArrayList<>();
            for (Registry.Arg a : s.args) {
                Map<String, Object> am = new LinkedHashMap<>();
                am.put("name", a.name);
                am.put("required", a.required);
                am.put("help", a.help);
                am.put("file", a.name.endsWith("-file") || a.name.equals("file"));
                args.add(am);
            }
            m.put("args", args);
            out.add(m);
        }
        return out;
    }

    /** One operation to run: its registered name, its arguments, and the text of its file arguments. */
    public static final class Call {
        public final String name;
        public final Map<String, String> args;
        public final Map<String, String> files;

        public Call(String name, Map<String, String> args, Map<String, String> files) {
            this.name = name;
            this.args = args;
            this.files = files;
        }
    }

    /**
     * Run operations through the core's transaction, as one change: load, apply each in order,
     * validate, and write unless one introduced an error. {@code files} carries the text of
     * arguments the CLI takes as a file path ({@code --content-file}); a repeatable argument's
     * values are joined by newlines, as the CLI joins them. {@code revision} must be the tree's
     * current one.
     *
     * <p>A dry run is run for real against a throwaway copy of the tree, so the answer carries
     * what a dry run alone cannot: each changed file, before and after, for the reviewer.
     */
    public synchronized Map<String, Object> run(List<Call> calls, boolean dryRun, boolean force, String revision) throws IOException {
        if (calls.isEmpty()) {
            throw new BadRequest("no operation given");
        }
        String current = watcher.refreshNow();
        if (revision == null || !revision.equals(current)) {
            throw new Stale("the tree changed since this was planned (planned against " + revision + ", now " + current + "); reload and try again");
        }
        // a file argument lives in a temp file until the transaction has run: some operations read it when
        // they are built, others (entitlement.set --definition-file) when they apply
        List<Path> temps = new ArrayList<>();
        try {
            List<Operation> ops = new ArrayList<>();
            for (Call c : calls) {
                ops.add(operation(c, temps));
            }
            Operation op = new Batch(ops);
            if (!dryRun) {
                Result r = Transaction.open(tree).run(op, false, force);
                Map<String, Object> m = new LinkedHashMap<>(Json.asMap(Json.parse(r.json())));
                cached = null;
                m.put("revision", watcher.refreshNow());
                return m;
            }
            Path copy = Files.createTempDirectory("idmweb-preview-");
            try {
                copyTree(tree, copy);
                Result r = Transaction.open(copy).run(op, false, force);
                Map<String, Object> m = new LinkedHashMap<>(Json.asMap(Json.parse(r.json())));
                m.put("dryRun", true);
                m.put("written", false);
                m.put("diffs", diffs(copy, r));
                m.put("revision", current);
                return m;
            } finally {
                deleteTree(copy);
            }
        } finally {
            for (Path t : temps) {
                Files.deleteIfExists(t);
            }
        }
    }

    private Operation operation(Call c, List<Path> temps) throws IOException {
        Registry.Spec spec = Registry.get(c.name);
        if (spec == null) {
            throw new NotFound("no operation '" + c.name + "'");
        }
        Map<String, String> all = new LinkedHashMap<>(c.args);
        // the server's package catalog stands in for --catalog when a package operation names none
        // every operation that takes the catalog gets the server's (package.*, and driver.add with --package)
        if (!all.containsKey("catalog") && catalogArg != null
                && spec.args.stream().anyMatch(a -> a.name.equals("catalog"))) {
            all.put("catalog", catalogArg);
        }
        for (Map.Entry<String, String> f : c.files.entrySet()) {
            Path t = Files.createTempFile("idmweb-", "-" + f.getKey());
            Files.writeString(t, f.getValue(), StandardCharsets.UTF_8);
            temps.add(t);
            all.put(f.getKey(), t.toString());
        }
        String missing = Registry.missing(spec, all);
        if (missing != null) {
            throw new BadRequest(c.name + ": " + missing);
        }
        try {
            return spec.create(all);
        } catch (IllegalArgumentException e) {
            throw new BadRequest(c.name + ": " + e.getMessage());
        }
    }

    static final long MAX_DIFF = 400L * 1024;

    private List<Object> diffs(Path copy, Result r) throws IOException {
        List<Object> out = new ArrayList<>();
        for (String f : r.changedFiles) {
            Path before = tree.resolve(f);
            Path after = copy.resolve(f);
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("file", f);
            d.put("status", Files.isRegularFile(before) ? "changed" : "added");
            d.put("language", language(f));
            if (textual(f) && sizeOf(before) <= MAX_DIFF && sizeOf(after) <= MAX_DIFF) {
                d.put("before", Files.isRegularFile(before) ? Files.readString(before, StandardCharsets.UTF_8) : "");
                d.put("after", Files.isRegularFile(after) ? Files.readString(after, StandardCharsets.UTF_8) : "");
            }
            out.add(d);
        }
        for (String f : r.deletedFiles) {
            Path before = tree.resolve(f);
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("file", f);
            d.put("status", "deleted");
            d.put("language", language(f));
            if (textual(f) && sizeOf(before) <= MAX_DIFF) {
                d.put("before", Files.isRegularFile(before) ? Files.readString(before, StandardCharsets.UTF_8) : "");
                d.put("after", "");
            }
            out.add(d);
        }
        return out;
    }

    private static boolean textual(String file) {
        String f = file.toLowerCase();
        return f.endsWith(".xml") || f.endsWith(".json") || f.endsWith(".js") || f.endsWith(".properties") || f.endsWith(".md") || f.endsWith(".txt") || f.endsWith(".xsl");
    }

    private static long sizeOf(Path p) throws IOException {
        return Files.isRegularFile(p) ? Files.size(p) : 0;
    }

    static void copyTree(Path from, Path to) throws IOException {
        Files.walkFileTree(from, new java.nio.file.SimpleFileVisitor<>() {
            @Override
            public java.nio.file.FileVisitResult preVisitDirectory(Path dir, java.nio.file.attribute.BasicFileAttributes attrs) throws IOException {
                if (!dir.equals(from) && (Watcher.SKIP.contains(dir.getFileName().toString()) || dir.getFileName().toString().equals("deploy-log"))) {
                    return java.nio.file.FileVisitResult.SKIP_SUBTREE;
                }
                Files.createDirectories(to.resolve(from.relativize(dir).toString()));
                return java.nio.file.FileVisitResult.CONTINUE;
            }

            @Override
            public java.nio.file.FileVisitResult visitFile(Path file, java.nio.file.attribute.BasicFileAttributes attrs) throws IOException {
                Files.copy(file, to.resolve(from.relativize(file).toString()));
                return java.nio.file.FileVisitResult.CONTINUE;
            }
        });
    }

    static void deleteTree(Path dir) {
        try (java.util.stream.Stream<Path> s = Files.walk(dir)) {
            s.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (IOException e) {
                    // a temp file left behind is the OS's to clean
                }
            });
        } catch (IOException e) {
            // best effort
        }
    }

    // ---- configuration and overrides, as editors read them ----

    /** A driver's settings, shim parameters, engine control values and the GCVs in its scope; no driver = the driver set's GCVs. */
    public synchronized Map<String, Object> config(String driver) throws IOException {
        DriverSet ds = model();
        Map<String, Object> m;
        if (driver == null || driver.isBlank()) {
            m = ConfigViews.driverSet(ds);
        } else {
            Driver d = ds.driver(driver);
            if (d == null) {
                throw new NotFound("no driver '" + driver + "' in the tree");
            }
            m = ConfigViews.driver(ds, d);
        }
        m.put("revision", cachedRevision);
        return m;
    }

    /** Every environment's overrides ({@code overrides/<env>.properties}), with each key's base value from the tree. */
    public synchronized Map<String, Object> overrides() throws IOException {
        DriverSet ds = model();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("revision", cachedRevision);
        m.put("environments", new ArrayList<>(ds.overrides.keySet()));
        java.util.TreeSet<String> keys = new java.util.TreeSet<>();
        for (Map<String, String> v : ds.overrides.values()) {
            keys.addAll(v.keySet());
        }
        List<Object> rows = new ArrayList<>();
        for (String key : keys) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("key", key);
            com.pointblue.dirxml.dev.deploy.Overrides.Target t = com.pointblue.dirxml.dev.deploy.Overrides.resolve(ds, key);
            row.put("resolved", t.resolved());
            row.put("problem", t.problem);
            row.put("base", t.resolved() ? t.value() : null);
            Map<String, Object> values = new LinkedHashMap<>();
            for (Map.Entry<String, Map<String, String>> e : ds.overrides.entrySet()) {
                if (e.getValue().containsKey(key)) {
                    values.put(e.getKey(), e.getValue().get(key));
                }
            }
            row.put("values", values);
            rows.add(row);
        }
        m.put("overrides", rows);
        return m;
    }

    
}
