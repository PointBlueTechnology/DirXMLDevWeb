package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.ascode.AsCodeReader;
import com.pointblue.dirxml.dev.model.DriverSet;
import com.pointblue.dirxml.dev.source.ExportWriter;
import com.pointblue.dirxml.dev.source.NewProject;
import com.pointblue.dirxml.dev.source.ProjectWriter;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * The round trip back to Designer (#66), as the CLI does it: a driver-set export XML ({@code idm export}),
 * an existing Designer project updated to match the tree and a whole new project ({@code idm export-project
 * [--new]}). Every write reads the tree as it is on disk, as the CLI does, so the output is the CLI's.
 *
 * <p>A project is written either to a path on the server's host (a deployer's) or round-tripped as a zip: an
 * existing project uploaded and given back updated, or a new one given back. No vault password is ever written
 * ({@link NewProject} has no field for one).
 */
final class DesignerExport {

    /** An uploaded project zip, and what it may unpack to. */
    static final long MAX_UPLOAD = 512L << 20;
    static final long MAX_UNPACKED = 2L << 30;
    static final int MAX_ENTRIES = 200_000;

    private final Path tree;
    private final String catalog;

    DesignerExport(Path tree, String catalog) {
        this.tree = tree;
        this.catalog = catalog;
    }

    /** The driver-set export (or one driver's, Designer's "Export Driver Configuration") as bytes. */
    byte[] xml(String driver) throws IOException {
        DriverSet ds = AsCodeReader.read(tree);
        if (driver != null && !driver.isBlank() && ds.driver(driver) == null) {
            throw new TreeService.NotFound("no driver '" + driver + "' in the tree");
        }
        Path tmp = Files.createTempFile("idmweb-export-", ".xml");
        try {
            if (driver == null || driver.isBlank()) {
                ExportWriter.write(ds, tmp);
            } else {
                ExportWriter.writeDriver(ds, driver, tmp);
            }
            return Files.readAllBytes(tmp);
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    /** The download's file name: the set's name, or the driver's. */
    String xmlName(String driver) throws IOException {
        String base = driver == null || driver.isBlank() ? AsCodeReader.read(tree).name : driver;
        return safeName(base == null || base.isBlank() ? "driverset" : base) + ".xml";
    }

    /**
     * {@code idm export-project <tree> <path> [--new …] [--dry-run]} against a directory on this host; {@code roots}
     * (hosted mode's {@code setup.roots}) bounds where, null for anywhere.
     */
    Map<String, Object> toPath(String mode, String path, boolean dryRun, NewProject opts, List<Path> roots) throws IOException {
        if (path == null || path.isBlank()) {
            throw new TreeService.BadRequest("which project directory? (an absolute path on the server's host)");
        }
        Path dir = Path.of(path.strip());
        if (!dir.isAbsolute()) {
            throw new TreeService.BadRequest("give the project directory as an absolute path on the server's host");
        }
        dir = dir.normalize();
        // hosted: only under the configured roots, as for attaching a path (#41); a local install writes where it is told
        if (roots != null && roots.stream().noneMatch(dir::startsWith)) {
            throw new TreeService.BadRequest(dir + " is outside the directories this server may write (setup.roots: " + roots + ")");
        }
        ProjectWriter.Result r;
        if (isNew(mode)) {
            r = ProjectWriter.create(tree, dir, withCatalog(opts), dryRun);
        } else {
            requireNoNewOptions(opts);
            if (!Files.isRegularFile(dir.resolve(".project"))) {
                throw new TreeService.BadRequest("'" + dir + "' is not a Designer project (no .project file)");
            }
            r = ProjectWriter.update(tree, dir, dryRun);
        }
        Map<String, Object> m = result(r, mode, dryRun);
        m.put("path", dir.toString());
        return m;
    }

    /**
     * A project as a zip: {@code mode=new} writes a new project named {@code name}; {@code mode=update} takes the
     * uploaded project zip ({@code body}) and updates it. A dry run (or a refusal) is the result as a map; an apply
     * is the zip to send, a temporary file the caller deletes.
     */
    Object zip(String mode, String name, boolean dryRun, NewProject opts, InputStream body, long length) throws IOException {
        Path work = Files.createTempDirectory("idmweb-project-");
        try {
            Path dir;
            ProjectWriter.Result r;
            if (isNew(mode)) {
                String n = name == null ? "" : name.strip();
                if (!n.matches("[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}")) {
                    throw new TreeService.BadRequest("name the new project: letters, digits, space, dot, dash and underscore (it becomes the folder and .proj name)");
                }
                dir = work.resolve(n);
                r = ProjectWriter.create(tree, dir, withCatalog(opts), dryRun);
            } else {
                requireNoNewOptions(opts);
                if (length == 0) {
                    throw new TreeService.BadRequest("upload the Designer project as a zip (the project folder, or its contents)");
                }
                if (length > MAX_UPLOAD) {
                    throw new TreeService.BadRequest("the zip is larger than " + (MAX_UPLOAD >> 20) + " MB");
                }
                Path in = work.resolve("in");
                unzip(body, in);
                dir = projectRoot(in);
                r = ProjectWriter.update(tree, dir, dryRun);
            }
            Map<String, Object> m = result(r, mode, dryRun);
            m.put("name", dir.getFileName().toString());
            if (dryRun || !r.ok) {
                return m;
            }
            Path out = Files.createTempFile("idmweb-project-", ".zip");
            zipDir(dir, out);
            return new Zip(out, safeName(dir.getFileName().toString()) + ".zip", m);
        } finally {
            TreeService.deleteTree(work); // the zip handed back is a file of its own
        }
    }

    /** An applied zip: the file to stream (then delete), its download name and the result for the audit. */
    record Zip(Path file, String fileName, Map<String, Object> result) {
    }

    private NewProject withCatalog(NewProject opts) {
        NewProject o = opts == null ? NewProject.defaults() : opts;
        return catalog == null || o.catalogDir != null ? o : o.withCatalog(Path.of(catalog));
    }

    private static boolean isNew(String mode) {
        if ("new".equals(mode)) {
            return true;
        }
        if (mode == null || "update".equals(mode)) {
            return false;
        }
        throw new TreeService.BadRequest("mode is update or new");
    }

    private static void requireNoNewOptions(NewProject o) {
        if (o != null && (o.vaultName != null || o.vaultHost != null || o.vaultUser != null || o.serverName != null || o.serverContext != null)) {
            throw new TreeService.BadRequest("the vault and server fields describe a new project; an existing project keeps its own");
        }
    }

    static Map<String, Object> result(ProjectWriter.Result r, String mode, boolean dryRun) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", r.ok);
        m.put("operation", isNew(mode) ? "export-project --new" : "export-project");
        m.put("dryRun", dryRun);
        m.put("written", !dryRun && r.ok);
        m.put("refusal", r.refusal);
        m.put("createdFiles", r.createdFiles);
        m.put("changedFiles", r.changedFiles);
        m.put("deletedFiles", r.deletedFiles);
        m.put("mintedIds", r.mintedIds);
        m.put("notes", r.notes);
        return m;
    }

    /** The project inside an unpacked zip: its root, or its one folder (a zip of the folder itself). */
    static Path projectRoot(Path in) throws IOException {
        if (Files.isRegularFile(in.resolve(".project"))) {
            return in;
        }
        List<Path> dirs = new ArrayList<>();
        try (Stream<Path> s = Files.list(in)) {
            s.filter(Files::isDirectory).filter(p -> !p.getFileName().toString().equals("__MACOSX")).forEach(dirs::add);
        }
        if (dirs.size() == 1 && Files.isRegularFile(dirs.get(0).resolve(".project"))) {
            return dirs.get(0);
        }
        throw new TreeService.BadRequest("the zip holds no Designer project: no .project at its root or in its one folder");
    }

    /** Unpacks with the usual guards: no entry outside {@code to}, bounded entries and size. */
    static void unzip(InputStream body, Path to) throws IOException {
        Files.createDirectories(to);
        Path root = to.toAbsolutePath().normalize();
        long total = 0;
        int count = 0;
        byte[] buf = new byte[64 * 1024];
        try (ZipInputStream z = new ZipInputStream(body)) {
            for (ZipEntry e = z.getNextEntry(); e != null; e = z.getNextEntry()) {
                if (++count > MAX_ENTRIES) {
                    throw new TreeService.BadRequest("the zip has more than " + MAX_ENTRIES + " entries");
                }
                Path p = root.resolve(e.getName()).normalize();
                if (!p.startsWith(root) || p.equals(root)) {
                    throw new TreeService.BadRequest("the zip has an entry outside its folder: " + e.getName());
                }
                if (e.isDirectory()) {
                    Files.createDirectories(p);
                    continue;
                }
                Files.createDirectories(p.getParent());
                try (OutputStream out = Files.newOutputStream(p)) {
                    for (int n; (n = z.read(buf)) > 0; ) {
                        total += n;
                        if (total > MAX_UNPACKED) {
                            throw new TreeService.BadRequest("the zip unpacks to more than " + (MAX_UNPACKED >> 30) + " GB");
                        }
                        out.write(buf, 0, n);
                    }
                }
            }
        }
        if (count == 0) {
            throw new TreeService.BadRequest("that is not a zip (or it is empty)");
        }
    }

    /** Zips {@code dir} with its own folder as the zip's one top-level entry, as Designer's import expects. */
    static void zipDir(Path dir, Path out) throws IOException {
        Path base = dir.getParent();
        try (ZipOutputStream z = new ZipOutputStream(Files.newOutputStream(out)); Stream<Path> s = Files.walk(dir)) {
            for (Path p : (Iterable<Path>) s.sorted()::iterator) {
                String name = base.relativize(p).toString().replace('\\', '/');
                if (Files.isDirectory(p)) {
                    z.putNextEntry(new ZipEntry(name + "/"));
                    z.closeEntry();
                } else {
                    z.putNextEntry(new ZipEntry(name));
                    Files.copy(p, z);
                    z.closeEntry();
                }
            }
        }
    }

    static String safeName(String s) {
        String n = s.replaceAll("[^A-Za-z0-9._ -]+", "-").replaceAll("^[-. ]+|[-. ]+$", "");
        return n.isEmpty() ? "export" : n;
    }
}
