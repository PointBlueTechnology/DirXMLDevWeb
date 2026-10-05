package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.json.Json;
import com.pointblue.dirxml.dev.packages.Catalog;
import com.pointblue.dirxml.dev.packages.PackageBuilder;
import com.pointblue.dirxml.dev.packages.PackageStatus;
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
