package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.json.Json;
import com.pointblue.dirxml.dev.packages.Catalog;
import com.pointblue.dirxml.dev.packages.Dependency;
import com.pointblue.dirxml.dev.packages.PackageInstall;
import com.pointblue.dirxml.dev.packages.PackageJar;
import com.pointblue.dirxml.dev.packages.PackageChecksum;
import com.pointblue.dirxml.dev.packages.PromptEngine;
import com.pointblue.dirxml.dev.xml.CanonicalXml;
import org.w3c.dom.Element;
import com.pointblue.dirxml.dev.packages.PackageBuilder;
import com.pointblue.dirxml.dev.packages.PackageStatus;
import com.pointblue.dirxml.dev.packages.PackageVersion;
import com.pointblue.dirxml.dev.packages.UpdateSite;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Packages: what the tree has installed against the catalog ({@code package.status}), the
 * catalog itself ({@code package.list}), and a package built from the tree into the catalog
 * ({@code package.build}). Install, upgrade, uninstall, revert, adopt and strip are the core's
 * operations, run through the same review as any other edit; the catalog directory is supplied
 * to them by the server ({@link #catalogArg()}).
 */
public final class PackageService {

    private final Path tree;
    private final Path catalogDir;

    public PackageService(Path tree, Path catalogDir) {
        this.tree = tree.toAbsolutePath().normalize();
        this.catalogDir = catalogDir == null ? null : catalogDir.toAbsolutePath().normalize();
    }

    /** The catalog the server was given: {@code --catalog DIR}, else {@code IDM_CATALOG}. */
    public static Path locate(Path given, String env) {
        if (given != null) {
            return given;
        }
        return env == null || env.isBlank() ? null : Path.of(env);
    }

    /** The {@code catalog} argument package operations take, or null when the server has none. A new directory becomes a catalog on first use. */
    public String catalogArg() {
        return catalogDir == null ? null : catalogDir.toString();
    }

    private Catalog catalog() throws IOException {
        if (catalogArg() == null) {
            return null;
        }
        return Catalog.open(catalogDir);
    }

    /** Installed packages per driver and the Library, with upgrades the catalog offers; and the catalog's packages. */
    public Map<String, Object> overview() throws IOException {
        Map<String, Object> m = new LinkedHashMap<>();
        Catalog c = catalog();
        Map<String, Object> cat = new LinkedHashMap<>();
        cat.put("dir", catalogDir == null ? null : catalogDir.toString());
        cat.put("available", c != null);
        List<Object> entries = new ArrayList<>();
        if (c != null) {
            for (Catalog.PackageEntry e : c.packages().values()) {
                Map<String, Object> one = new LinkedHashMap<>();
                one.put("short", e.shortName);
                one.put("id", e.id);
                one.put("displayName", e.displayName);
                one.put("type", e.type);
                one.put("base", e.base);
                one.put("versions", new ArrayList<>(e.versions.keySet()));
                one.put("newest", e.newestVersion());
                // what the newest version declares: its feature packages (by short name where the catalog has
                // them), the shims it supports, whether installing it asks questions
                Catalog.VersionEntry ve = e.newestVersion() == null ? null : e.versions.get(e.newestVersion());
                Map<String, String> ids = c.idIndex();
                List<Object> features = new ArrayList<>();
                if (ve != null) {
                    for (Dependency.Feature f : ve.features) {
                        Map<String, Object> fm = new LinkedHashMap<>();
                        fm.put("id", f.packageId);
                        fm.put("short", ids.get(f.packageId));
                        fm.put("displayName", f.displayName);
                        fm.put("mandatory", f.mandatory);
                        fm.put("group", f.group);
                        features.add(fm);
                    }
                }
                one.put("features", features);
                List<Object> shims = new ArrayList<>();
                if (ve != null) {
                    for (Dependency.SupportedDriver sd : ve.supportedDrivers) {
                        shims.add(sd.driverId);
                    }
                }
                one.put("supportedDrivers", shims);
                one.put("hasPrompts", ve != null && ve.hasPrompts);
                entries.add(one);
            }
        }
        cat.put("packages", entries);
        m.put("catalog", cat);
        PackageStatus s = PackageStatus.of(tree, null, c);
        m.put("status", Json.parse(s.json()));
        m.put("text", s.text());
        return m;
    }

    /** The update sites the catalog knows ({@code sites.properties}; Designer's public sites by default). */
    public Map<String, Object> sites() throws IOException {
        Map<String, Object> m = new LinkedHashMap<>();
        Catalog c = catalog();
        List<Object> list = new ArrayList<>();
        if (c != null) {
            for (Map.Entry<String, String> e : c.sites().entrySet()) {
                Map<String, Object> one = new LinkedHashMap<>();
                one.put("name", e.getKey());
                one.put("url", e.getValue());
                list.add(one);
            }
        }
        m.put("available", c != null);
        m.put("sites", list);
        return m;
    }

    /** A site name from {@code sites.properties}, else the string is the URL. */
    private String siteUrl(String site) throws IOException {
        Catalog c = catalog();
        if (c != null) {
            String url = c.sites().get(site);
            if (url != null) {
                return url;
            }
        }
        if (!site.startsWith("http://") && !site.startsWith("https://")) {
            throw new TreeService.BadRequest("site must be a name from sites.properties or an http(s) URL: " + site);
        }
        return site;
    }

    /** What a site offers, against the catalog: each package's versions there, which the catalog has, whether the site is ahead. */
    public Map<String, Object> site(String site) throws IOException {
        String url = siteUrl(site);
        Catalog c = catalog();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("url", url);
        List<Object> list = new ArrayList<>();
        try {
            Map<String, List<String>> byShort = new LinkedHashMap<>();
            for (UpdateSite.Offer o : UpdateSite.list(url)) {
                byShort.computeIfAbsent(o.shortName, k -> new ArrayList<>()).add(o.version);
            }
            for (Map.Entry<String, List<String>> e : byShort.entrySet()) {
                Catalog.PackageEntry have = c == null ? null : c.get(e.getKey());
                String newest = e.getValue().get(0);
                String newestHave = have == null ? null : have.newestVersion();
                Map<String, Object> one = new LinkedHashMap<>();
                one.put("short", e.getKey());
                one.put("displayName", have == null ? null : have.displayName);
                one.put("versions", e.getValue());
                one.put("newest", newest);
                one.put("inCatalog", have == null ? List.of() : new ArrayList<>(have.versions.keySet()));
                one.put("newer", newestHave != null && PackageVersion.parse(newest).compareTo(PackageVersion.parse(newestHave)) > 0);
                list.add(one);
            }
            m.put("ok", true);
        } catch (IOException | RuntimeException ex) {
            m.put("ok", false);
            m.put("error", ex.getMessage() == null || ex.getMessage().isBlank() ? ex.getClass().getSimpleName() : ex.getMessage());
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            m.put("ok", false);
            m.put("error", "interrupted");
        }
        m.put("packages", list);
        return m;
    }

    /**
     * Fetch packages from a site into the catalog ({@code package.fetch}): {@code site} (name or URL),
     * {@code packages} (SHORT or SHORT_version each), {@code allVersions}, {@code dryRun}. A catalog
     * change, not a tree change: nothing is installed until a package.install is reviewed.
     */
    public Map<String, Object> fetch(Map<String, Object> req) throws IOException {
        Catalog c = catalog();
        if (c == null) {
            throw new TreeService.BadRequest("no catalog on this server (start it with --catalog DIR)");
        }
        String site = Json.asString(req.get("site"));
        if (site == null || site.isBlank()) {
            throw new TreeService.BadRequest("site is required");
        }
        List<String> specs = new ArrayList<>();
        if (req.get("packages") instanceof List) {
            for (Object o : (List<?>) req.get("packages")) {
                if (o != null && !o.toString().isBlank()) {
                    specs.add(o.toString().trim());
                }
            }
        }
        if (specs.isEmpty()) {
            throw new TreeService.BadRequest("packages is required: SHORT or SHORT_version, one or more");
        }
        UpdateSite.FetchResult r;
        try {
            r = UpdateSite.fetch(c, siteUrl(site), specs, Boolean.TRUE.equals(req.get("allVersions")), Boolean.TRUE.equals(req.get("dryRun")));
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IOException("interrupted while fetching from " + site);
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", r.error == null);
        if (r.error != null) {
            m.put("error", r.error);
        }
        m.put("added", new ArrayList<>(r.added));
        m.put("skipped", new ArrayList<>(r.skipped));
        m.put("refused", new ArrayList<>(r.refused));
        return m;
    }

    /**
     * The questions installing {@code packages} (SHORT[_ver], comma-separated) would ask, each prompt's
     * definitions pre-populated the way the install does (the prompt stylesheet run against a driver
     * named {@code driver} with no other attributes — the new-driver case; an existing driver's
     * attributes would only change defaults). The page renders them and sends the answers as a
     * {@code name=value} file; a prompt that references a named password lists the keys it needs.
     */
    public Map<String, Object> prompts(String packages, String driver) throws IOException {
        Catalog c = catalog();
        if (c == null) {
            throw new TreeService.BadRequest("no catalog on this server");
        }
        List<Object> out = new ArrayList<>();
        List<java.nio.file.Path> jars;
        try {
            jars = PackageInstall.jarsOf(null, c.dir.toString(), packages);
        } catch (RuntimeException e) {
            throw new TreeService.BadRequest("packages: " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
        }
        for (java.nio.file.Path jar : jars) {
            PackageJar p = PackageJar.read(jar);
            List<PromptEngine.Prompt> prompts = new ArrayList<>();
            for (PackageJar.Item it : p.items) {
                if (PackageChecksum.RESOURCE.equals(it.objectClass) && it.contentType != null
                    && it.contentType.startsWith(PackageInstall.PKG_PROMPT) && it.directive != null) {
                    prompts.add(PromptEngine.read(it, p.propertiesFor(PackageInstall.LANGUAGE)));
                }
            }
            prompts.sort((a, b) -> Integer.compare(a.order, b.order));
            Element cur = CanonicalXml.parse("<ds-attributes/>").getDocumentElement();
            if (driver != null && !driver.isBlank()) {
                cur.setAttribute("name", driver);
            }
            Element np = CanonicalXml.parse("<named-passwords/>").getDocumentElement();
            for (PromptEngine.Prompt pr : prompts) {
                PromptEngine.answer(pr, Map.of(), cur, np, false);
                Map<String, Object> pm = new LinkedHashMap<>();
                pm.put("package", p.shortName);
                pm.put("version", p.version);
                pm.put("prompt", pr.name);
                pm.put("definitions", ConfigViews.definitions(pr.definitions, null));
                pm.put("unanswered", new ArrayList<>(pr.unanswered));
                pm.put("passwordRefs", new ArrayList<>(pr.passwordRefs));
                out.add(pm);
            }
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("packages", packages);
        m.put("prompts", out);
        return m;
    }

    /** A package jar uploaded from the page into the catalog ({@code package.import}); the name is only for the record. */
    public Map<String, Object> importJar(String fileName, java.io.InputStream body) throws IOException {
        Catalog c = catalog();
        if (c == null) {
            throw new TreeService.BadRequest("no catalog on this server (start it with --catalog DIR)");
        }
        Path tmp = Files.createTempFile("idmweb-import-", ".jar");
        try {
            Files.copy(body, tmp, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            Catalog.AddResult r = c.add(tmp, "import:" + (fileName == null ? "upload" : fileName));
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("ok", r.ok());
            m.put("added", r.added);
            m.put("short", r.shortName);
            m.put("version", r.version);
            if (!r.ok()) {
                m.put("refusal", r.refusal);
            }
            return m;
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    /** Build a package from a driver (or the Library) and add it to the catalog. */
    public Map<String, Object> build(Map<String, Object> req) throws IOException {
        Catalog c = catalog();
        if (c == null) {
            throw new TreeService.BadRequest("no package catalog: start the server with --catalog DIR (or IDM_CATALOG) to build packages");
        }
        PackageBuilder.Options o = new PackageBuilder.Options();
        o.tree = tree;
        o.driver = blank(Json.asString(req.get("driver")));
        o.shortName = blank(Json.asString(req.get("short")));
        o.name = blank(Json.asString(req.get("name")));
        if (o.shortName == null || o.name == null) {
            throw new TreeService.BadRequest("a package needs a short name and a display name");
        }
        if (blank(Json.asString(req.get("vendor"))) != null) {
            o.vendor = Json.asString(req.get("vendor"));
        }
        if (blank(Json.asString(req.get("version"))) != null) {
            o.version = Json.asString(req.get("version"));
        }
        if (blank(Json.asString(req.get("description"))) != null) {
            o.description = Json.asString(req.get("description"));
        }
        o.include.addAll(strings(req.get("include")));
        o.depends.addAll(strings(req.get("depends")));
        o.base = Boolean.TRUE.equals(req.get("base"));
        if (blank(Json.asString(req.get("customized"))) != null) {
            o.customized = Json.asString(req.get("customized"));
        }
        if (blank(Json.asString(req.get("gcvs"))) != null) {
            o.gcvs = Json.asString(req.get("gcvs"));
        }
        o.catalog = c;
        String previous = blank(Json.asString(req.get("newVersionOf")));
        if (previous != null) {
            int us = previous.lastIndexOf('_');
            if (us < 0) {
                throw new TreeService.BadRequest("newVersionOf is SHORT_version");
            }
            o.newVersionOf = c.jar(previous.substring(0, us), previous.substring(us + 1));
            if (!Files.isRegularFile(o.newVersionOf)) {
                throw new TreeService.BadRequest("the catalog has no " + previous);
            }
        }
        Path tmp = Files.createTempDirectory("idmweb-pkgbuild");
        try {
            PackageBuilder.Result r = PackageBuilder.build(o, tmp);
            if (r.ok) {
                Catalog.AddResult a = c.add(r.jar, "built");
                if (!a.ok()) {
                    r.ok = false;
                    r.refusal = "built, but the catalog refused it: " + a.refusal;
                } else {
                    r.jar = c.jar(a.shortName, a.version);
                    r.notes.add("added to the catalog as " + a.shortName + "_" + a.version);
                }
            }
            Map<String, Object> m = new LinkedHashMap<>(Json.asMap(Json.parse(r.json())));
            m.put("text", r.text());
            return m;
        } finally {
            TreeService.deleteTree(tmp);
        }
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    private static List<String> strings(Object o) {
        List<String> out = new ArrayList<>();
        if (o instanceof List) {
            for (Object x : (List<?>) o) {
                if (x != null && !String.valueOf(x).isBlank()) {
                    out.add(String.valueOf(x));
                }
            }
        }
        return out;
    }
}
