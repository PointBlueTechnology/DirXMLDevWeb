package com.pointblue.dirxml.web;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * A project put away (#76): its repository as a git bundle (the complete history, every ref),
 * everything the server holds for it moved aside — workspaces, every person's trace recordings,
 * a repository the server made for it, its token — into {@code data.dir/archive/<project>-<when>/},
 * and the project forgotten. Nothing is deleted: the directory stays until the operator removes
 * it; the bundle downloads from the page. A plain forget ({@code SetupService.remove}) stays
 * beside it.
 */
public final class ArchiveService {
    private static final Pattern DIR_NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]*");
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneId.systemDefault());

    private final Hosted hosted;
    private final Workspaces workspaces;
    private final Audit audit;

    public ArchiveService(Hosted hosted, Workspaces workspaces, Audit audit) {
        this.hosted = hosted;
        this.workspaces = workspaces;
        this.audit = audit;
    }

    public Path root() {
        return hosted.dataDir.resolve("archive");
    }

    /** Bundle, move aside, forget. Refused (nothing moved) when the repository cannot be bundled. */
    public synchronized Map<String, Object> archive(Session session, String name) throws IOException {
        Project p = workspaces.project(name);
        String dirName = p.name + "-" + STAMP.format(Instant.now());
        Path dir = root().resolve(dirName);
        Files.createDirectories(dir);
        try {
            Files.setPosixFilePermissions(dir, PosixFilePermissions.fromString("rwx------"));
        } catch (UnsupportedOperationException ignore) {
            // not a POSIX file system
        }
        List<String> moved = new ArrayList<>();
        // 1. the repository, complete, before anything moves
        Path bundle = dir.resolve(p.name + ".bundle");
        String source = bundle(p, bundle, dir);
        // 2. nothing of the project stays open
        workspaces.projectChanged(p.name);
        // 3. move aside what the server holds for it
        move(hosted.dataDir.resolve("workspaces").resolve(Workspaces.safe(p.name)), dir.resolve("workspaces"), moved);
        move(hosted.dataDir.resolve("traces").resolve(Workspaces.safe(p.name)), dir.resolve("traces-shared"), moved);
        Path users = hosted.dataDir.resolve("users");
        if (Files.isDirectory(users)) {
            try (Stream<Path> s = Files.list(users)) {
                for (Path u : (Iterable<Path>) s.sorted()::iterator) {
                    move(u.resolve("traces").resolve(Workspaces.safe(p.name)), dir.resolve("traces").resolve(u.getFileName().toString()), moved);
                }
            }
        }
        Path bare = hosted.dataDir.resolve("projects").resolve(p.name + ".git");
        if (Files.isDirectory(bare)) {
            move(bare, dir.resolve(p.name + ".git"), moved);
        }
        move(hosted.dataDir.resolve("secrets").resolve(p.name + ".repo.token"), dir.resolve(p.name + ".repo.token"), moved);
        // 4. forget it
        hosted.removeProject(p.name);
        workspaces.projectChanged(p.name);
        // 5. say what happened
        PropertiesFile pf = new PropertiesFile(dir.resolve("archive.properties"));
        pf.set("project", p.name);
        pf.set("archivedAt", Instant.now().toString());
        pf.set("by", session == null ? "" : session.principal.subject);
        pf.set("repository", p.shownUrl() == null ? (p.inPlace == null ? "" : p.inPlace.toString()) : p.shownUrl());
        pf.set("source", source);
        pf.set("bundle", bundle.getFileName().toString());
        pf.set("moved", String.join(",", moved));
        pf.save();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("archived", p.name);
        m.put("name", dirName);
        m.put("dir", dir.toString());
        m.put("bundle", bundle.getFileName().toString());
        m.put("bytes", Files.size(bundle));
        m.put("moved", moved);
        if (audit != null) {
            audit.log(session, null, "project.archive", Map.of("project", p.name, "archive", dirName, "bytes", Files.size(bundle), "moved", moved.size()), "ok");
        }
        return m;
    }

    /** {@code git bundle create <file> --all} from the repository the project names; returns where it was taken from. */
    private String bundle(Project p, Path bundle, Path dir) throws IOException {
        Git git = workspaces.git();
        if (p.inPlace != null) {
            must(git.run(p.inPlace, "bundle", "create", bundle.toString(), "--all"), "bundle " + p.inPlace);
            return p.inPlace.toString();
        }
        Path local = p.url != null && !p.url.contains("://") && !p.url.startsWith("git@") ? Path.of(p.url) : null;
        if (local != null && Files.isDirectory(local)) {
            must(git.run(local, "bundle", "create", bundle.toString(), "--all"), "bundle " + local);
            return local.toString();
        }
        // a remote: a complete mirror first, then the bundle; the mirror goes, the bundle has it all
        Path mirror = dir.resolve("mirror.git");
        must(workspaces.gitFor(p).run(dir, "clone", "--mirror", "--quiet", p.url, mirror.toString()), "mirror " + p.shownUrl());
        must(git.run(mirror, "bundle", "create", bundle.toString(), "--all"), "bundle " + p.shownUrl());
        deleteTree(mirror);
        return p.shownUrl();
    }

    private static void must(Git.Result r, String what) {
        if (!r.ok()) {
            throw new TreeService.BadRequest(what + ": " + (r.err.isBlank() ? r.out : r.err).trim());
        }
    }

    private static void move(Path from, Path to, List<String> moved) throws IOException {
        if (!Files.exists(from)) {
            return;
        }
        Files.createDirectories(to.getParent());
        Files.move(from, to, StandardCopyOption.ATOMIC_MOVE);
        moved.add(from.getFileName().toString() + " -> " + to.getParent().getFileName() + "/" + to.getFileName());
    }

    private static void deleteTree(Path dir) throws IOException {
        if (!Files.exists(dir)) {
            return;
        }
        try (Stream<Path> s = Files.walk(dir)) {
            for (Path p : (Iterable<Path>) s.sorted(java.util.Comparator.reverseOrder())::iterator) {
                Files.delete(p);
            }
        }
    }

    /** Every archive, newest first: what it holds and where. */
    public List<Map<String, Object>> list() throws IOException {
        List<Map<String, Object>> out = new ArrayList<>();
        if (!Files.isDirectory(root())) {
            return out;
        }
        try (Stream<Path> s = Files.list(root())) {
            for (Path d : (Iterable<Path>) s.sorted(java.util.Comparator.reverseOrder())::iterator) {
                Path props = d.resolve("archive.properties");
                if (!Files.isRegularFile(props)) {
                    continue;
                }
                Map<String, String> p = new PropertiesFile(props).entries();
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("name", d.getFileName().toString());
                m.put("dir", d.toString());
                m.put("project", p.get("project"));
                m.put("archivedAt", p.get("archivedAt"));
                m.put("by", p.get("by"));
                m.put("repository", p.get("repository"));
                m.put("bundle", p.get("bundle"));
                Path b = p.get("bundle") == null ? null : d.resolve(p.get("bundle"));
                m.put("bytes", b != null && Files.isRegularFile(b) ? Files.size(b) : null);
                m.put("moved", p.get("moved") == null || p.get("moved").isBlank() ? List.of() : List.of(p.get("moved").split(",")));
                out.add(m);
            }
        }
        return out;
    }

    /** The bundle of an archive, for download; refuses a name that could leave the directory. */
    public Path bundle(String archiveName) throws IOException {
        if (archiveName == null || !DIR_NAME.matcher(archiveName).matches()) {
            throw new TreeService.BadRequest("an archive name is letters, digits, '.', '_' and '-'");
        }
        Path d = root().resolve(archiveName).normalize();
        Path props = d.resolve("archive.properties");
        if (!d.startsWith(root()) || !Files.isRegularFile(props)) {
            throw new TreeService.NotFound("no archive " + archiveName);
        }
        String b = new PropertiesFile(props).entries().get("bundle");
        Path bundle = b == null ? null : d.resolve(b).normalize();
        if (bundle == null || !bundle.startsWith(d) || !Files.isRegularFile(bundle)) {
            throw new TreeService.NotFound("archive " + archiveName + " has no bundle");
        }
        return bundle;
    }
}
