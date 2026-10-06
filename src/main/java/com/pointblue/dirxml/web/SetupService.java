package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.ascode.AsCodeWriter;
import com.pointblue.dirxml.dev.deploy.Environments;
import com.pointblue.dirxml.dev.deploy.Overrides;
import com.pointblue.dirxml.dev.deploy.Secrets;
import com.pointblue.dirxml.dev.deploy.VaultDiff;
import com.pointblue.dirxml.dev.json.Json;
import com.pointblue.dirxml.dev.model.DriverSet;
import com.pointblue.dirxml.dev.source.ExportReader;
import com.pointblue.dirxml.dev.source.ProjectReader;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * The first run of a hosted server with no repository: where the tree comes from. Each way
 * ends with a repository the server then works from — one it makes in its data directory from
 * an imported tree, an existing one on this host, or a remote it clones — and the choice is
 * written into the configuration for the next start.
 */
public final class SetupService {

    private final Hosted hosted;
    private final Workspaces workspaces;
    private final Audit audit;

    public SetupService(Hosted hosted, Workspaces workspaces, Audit audit) {
        this.hosted = hosted;
        this.workspaces = workspaces;
        this.audit = audit;
    }

    /** Whether setup is needed, and what the host offers. */
    public Map<String, Object> state() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("needed", workspaces.needsSetup());
        m.put("dataDir", hosted.dataDir.toString());
        m.put("repository", hosted.repoUrl == null ? null : hosted.repoUrl.replaceAll("://[^@/]+@", "://"));
        m.put("inPlace", hosted.inPlace == null ? null : hosted.inPlace.toString());
        return m;
    }

    private void done(Session session, String how, Map<String, Object> details) {
        audit.log(session, null, "setup." + how, details, "ok");
    }

    /** A tree read from the vault of an environment the Connections view knows. */
    public Map<String, Object> fromVault(Session session, String envName) throws IOException {
        if (envName == null || envName.isBlank()) {
            throw new TreeService.BadRequest("which environment?");
        }
        Environments.Environment env = Environments.load().get(envName);
        List<String> notes = new ArrayList<>();
        DriverSet live = VaultDiff.readLive(env, notes::add);
        if (env.secretsFile != null) {
            for (String d : Overrides.stripSecretShimAuthIds(live, Secrets.load(env.secretsFile))) {
                notes.add("'" + d + "'.shim-auth-id kept out of the tree (the secrets file supplies it)");
            }
        }
        Map<String, Object> m = seedRepository(live, "Imported from " + envName + " (" + env.driverSetDn + ")");
        m.put("notes", notes);
        done(session, "vault", Map.of("env", envName, "drivers", live.drivers.size()));
        return m;
    }

    /** A tree read from an uploaded Designer project (a zip of the project directory) or export (an XML file). */
    public Map<String, Object> fromUpload(Session session, String kind, String fileName, InputStream body) throws IOException {
        Path tmp = Files.createTempDirectory("idmweb-setup");
        try {
            DriverSet ds;
            String what;
            if ("export".equals(kind) || (fileName != null && fileName.toLowerCase().endsWith(".xml"))) {
                Path f = tmp.resolve("export.xml");
                Files.copy(body, f);
                ds = ExportReader.read(f);
                what = "Imported from the Designer export " + (fileName == null ? "" : fileName);
            } else {
                Path dir = tmp.resolve("project");
                unzip(body, dir);
                Path project = findProject(dir);
                if (project == null) {
                    throw new TreeService.BadRequest("the zip holds no Designer project (no .project file or Model/ directory in it)");
                }
                ds = ProjectReader.read(project);
                what = "Imported from the Designer project " + (fileName == null ? "" : fileName);
            }
            Map<String, Object> m = seedRepository(ds, what);
            done(session, kind, Map.of("file", String.valueOf(fileName), "drivers", ds.drivers.size()));
            return m;
        } catch (RuntimeException e) {
            throw new TreeService.BadRequest("cannot read that: " + (e.getMessage() == null ? e.toString() : e.getMessage()));
        } finally {
            TreeService.deleteTree(tmp);
        }
    }

    /** A Designer project directory the server can see (the single-user layout mounts the person's files). */
    public Map<String, Object> fromProjectPath(Session session, String path) throws IOException {
        Path p = existingDir(path);
        Path project = findProject(p);
        if (project == null) {
            throw new TreeService.BadRequest(path + " holds no Designer project (no .project file or Model/ directory)");
        }
        DriverSet ds;
        try {
            ds = ProjectReader.read(project);
        } catch (RuntimeException e) {
            throw new TreeService.BadRequest("cannot read the project: " + e.getMessage());
        }
        Map<String, Object> m = seedRepository(ds, "Imported from the Designer project " + project.getFileName());
        done(session, "project", Map.of("path", project.toString(), "drivers", ds.drivers.size()));
        return m;
    }

    /** A repository already on this host: bare (cloned per branch, as a remote would be) or a checkout (used in place). */
    public Map<String, Object> existingRepository(Session session, String path) throws IOException {
        Path p = existingDir(path);
        Git git = workspaces.git();
        boolean bare = "true".equals(git.run(p, "rev-parse", "--is-bare-repository").out.trim());
        boolean checkout = Files.isDirectory(p.resolve(".git"));
        if (!bare && !checkout) {
            throw new TreeService.BadRequest(path + " is not a git repository (neither bare nor a checkout); 'Use a directory of files' is for a plain tree");
        }
        Map<String, Object> m = new LinkedHashMap<>();
        if (bare) {
            String tree = treeIn(p, null);
            hosted.saveRepository(p.toString(), tree, "cases", defaultBranch(p), null, null);
            workspaces.repositoryChanged(git);
            m.put("repository", p.toString());
            m.put("tree", tree);
        } else {
            String tree = treeIn(null, p);
            hosted.saveRepository(null, tree, "cases", git.run(p, "rev-parse", "--abbrev-ref", "HEAD").out.trim(), p, null);
            workspaces.repositoryChanged(git);
            m.put("inPlace", p.toString());
            m.put("tree", tree);
        }
        done(session, "existing", Map.of("path", p.toString(), "bare", bare));
        return m;
    }

    /** A plain directory holding a tree (or tree/ and cases/): made into a repository in place, then used in place. */
    public Map<String, Object> fromDirectory(Session session, String path) throws IOException {
        Path p = existingDir(path);
        if (Files.isDirectory(p.resolve(".git"))) {
            return existingRepository(session, path);
        }
        String tree = treeIn(null, p);
        Git git = workspaces.git();
        Git.Result r = git.run(p, "init", "-q", "-b", "main");
        if (!r.ok()) {
            throw new TreeService.BadRequest("git init in " + p + ": " + r.err.trim());
        }
        Files.writeString(p.resolve(".gitignore"), "deploy-snapshots/\n.dirxmldev/\n", StandardCharsets.UTF_8);
        git.run(p, "add", "-A");
        git.run(p, "-c", "user.name=DirXMLDevWeb", "-c", "user.email=idmweb@localhost", "commit", "-q", "-m", "Initial tree");
        hosted.saveRepository(null, tree, "cases", "main", p, null);
        workspaces.repositoryChanged(git);
        done(session, "directory", Map.of("path", p.toString()));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("inPlace", p.toString());
        m.put("tree", tree);
        return m;
    }

    /** A remote to clone, with a token for an https remote if it needs one. */
    public Map<String, Object> cloneRemote(Session session, String url, String token, String base) throws IOException {
        if (url == null || url.isBlank()) {
            throw new TreeService.BadRequest("which repository?");
        }
        url = url.trim();
        Git git = new Git(hosted.dataDir, token == null || token.isBlank() ? hosted.repoToken() : token, hosted.repoSshKey);
        Git.Result ls = git.run(null, "ls-remote", "--heads", url);
        if (!ls.ok()) {
            throw new TreeService.BadRequest("cannot reach " + url.replaceAll("://[^@/]+@", "://") + ": " + ls.err.trim());
        }
        List<String> heads = new ArrayList<>();
        for (String l : ls.out.split("\n")) {
            int i = l.indexOf("refs/heads/");
            if (i > 0) {
                heads.add(l.substring(i + "refs/heads/".length()).trim());
            }
        }
        String b = base != null && !base.isBlank() ? base.trim() : heads.contains("main") ? "main" : heads.contains("master") ? "master" : heads.isEmpty() ? "main" : heads.get(0);
        // find where the tree sits by cloning the base once
        Path probe = Files.createTempDirectory("idmweb-probe");
        String tree;
        try {
            Git.Result c = git.run(null, "clone", "-q", "--depth", "1", "--branch", b, url, probe.resolve("r").toString());
            if (!c.ok()) {
                throw new TreeService.BadRequest("clone: " + c.err.trim());
            }
            tree = treeIn(null, probe.resolve("r"));
        } finally {
            TreeService.deleteTree(probe);
        }
        hosted.saveRepository(url, tree, "cases", b, null, token);
        workspaces.repositoryChanged(git);
        done(session, "clone", Map.of("url", url.replaceAll("://[^@/]+@", "://"), "base", b));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("repository", url.replaceAll("://[^@/]+@", "://"));
        m.put("base", b);
        m.put("tree", tree);
        m.put("branches", heads);
        return m;
    }

    // ---- helpers ------------------------------------------------------------------------------

    /** Write the tree into data/repo.git (main: tree/, cases/) and point the server at it. */
    private Map<String, Object> seedRepository(DriverSet ds, String message) throws IOException {
        Path repo = hosted.dataDir.resolve("repo.git");
        if (Files.exists(repo)) {
            throw new TreeService.BadRequest(repo + " exists already; choose 'an existing repository' for it, or move it aside");
        }
        Path seed = Files.createTempDirectory("idmweb-seed");
        Git git = workspaces.git();
        try {
            Path tree = seed.resolve("tree");
            AsCodeWriter.write(ds, tree);
            Files.createDirectories(seed.resolve("cases"));
            Files.writeString(seed.resolve("cases").resolve("README.md"), "# Simulator cases\n\nOne directory per case: `case.properties` and `input.xds`; the Simulator view creates them.\n", StandardCharsets.UTF_8);
            Files.writeString(seed.resolve(".gitignore"), "deploy-snapshots/\n.dirxmldev/\n", StandardCharsets.UTF_8);
            must(git.run(seed, "init", "-q", "-b", "main"), "git init");
            must(git.run(seed, "add", "-A"), "git add");
            must(git.run(seed, "-c", "user.name=DirXMLDevWeb", "-c", "user.email=idmweb@localhost", "commit", "-q", "-m", message), "git commit");
            must(git.run(null, "init", "-q", "--bare", "-b", "main", repo.toString()), "git init --bare");
            must(git.run(seed, "push", "-q", repo.toString(), "main"), "git push");
        } finally {
            TreeService.deleteTree(seed);
        }
        hosted.saveRepository(repo.toString(), "tree", "cases", "main", null, null);
        workspaces.repositoryChanged(git);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("repository", repo.toString());
        m.put("tree", "tree");
        m.put("drivers", ds.drivers.size());
        return m;
    }

    private static void must(Git.Result r, String what) {
        if (!r.ok()) {
            throw new TreeService.BadRequest(what + ": " + (r.err.isBlank() ? r.out : r.err).trim());
        }
    }

    private static Path existingDir(String path) {
        if (path == null || path.isBlank()) {
            throw new TreeService.BadRequest("which directory?");
        }
        Path p = Path.of(path.trim()).toAbsolutePath().normalize();
        if (!Files.isDirectory(p)) {
            throw new TreeService.BadRequest(p + " is not a directory this server can see (in a container, mount it)");
        }
        return p;
    }

    /** Where the tree is inside a repository: "." or "tree", by where driverset.xml sits. */
    private String treeIn(Path bare, Path checkout) throws IOException {
        if (checkout != null) {
            if (Files.isRegularFile(checkout.resolve("driverset.xml"))) {
                return ".";
            }
            if (Files.isRegularFile(checkout.resolve("tree").resolve("driverset.xml"))) {
                return "tree";
            }
            throw new TreeService.BadRequest("no driverset.xml at the top of " + checkout + " or in its tree/ directory");
        }
        Git git = workspaces.git();
        String b = defaultBranch(bare);
        for (String[] c : new String[][] {{"driverset.xml", "."}, {"tree/driverset.xml", "tree"}}) {
            if (git.run(bare, "cat-file", "-e", b + ":" + c[0]).ok()) {
                return c[1];
            }
        }
        throw new TreeService.BadRequest("no driverset.xml at the top of branch " + b + " or in its tree/ directory");
    }

    private String defaultBranch(Path bare) throws IOException {
        Git git = workspaces.git();
        String head = git.run(bare, "symbolic-ref", "--short", "HEAD").out.trim();
        if (!head.isEmpty() && git.run(bare, "rev-parse", "--verify", "--quiet", head).ok()) {
            return head;
        }
        for (String b : new String[] {"main", "master"}) {
            if (git.run(bare, "rev-parse", "--verify", "--quiet", b).ok()) {
                return b;
            }
        }
        return head.isEmpty() ? "main" : head;
    }

    private static void unzip(InputStream in, Path dir) throws IOException {
        Files.createDirectories(dir);
        try (ZipInputStream zip = new ZipInputStream(in)) {
            ZipEntry e;
            long total = 0;
            while ((e = zip.getNextEntry()) != null) {
                Path out = dir.resolve(e.getName()).normalize();
                if (!out.startsWith(dir)) {
                    throw new TreeService.BadRequest("the zip has an entry outside itself: " + e.getName());
                }
                if (e.isDirectory()) {
                    Files.createDirectories(out);
                } else {
                    Files.createDirectories(out.getParent());
                    byte[] data = zip.readAllBytes();
                    total += data.length;
                    if (total > 512L * 1024 * 1024) {
                        throw new TreeService.BadRequest("the zip is larger than 512 MB unpacked");
                    }
                    Files.write(out, data);
                }
            }
        }
    }

    /** The project directory inside what was unpacked (the zip may hold the directory itself, or its contents). */
    static Path findProject(Path root) throws IOException {
        if (isProject(root)) {
            return root;
        }
        try (var s = Files.walk(root, 3)) {
            for (Path p : (Iterable<Path>) s::iterator) {
                if (Files.isDirectory(p) && !p.equals(root) && isProject(p)) {
                    return p;
                }
            }
        }
        return null;
    }

    private static boolean isProject(Path p) {
        return Files.isRegularFile(p.resolve(".project")) || Files.isDirectory(p.resolve("Model"));
    }

    /** JSON of a request body. */
    static Map<String, Object> json(InputStream body) throws IOException {
        return Json.asMap(Json.parse(new String(body.readAllBytes(), StandardCharsets.UTF_8)));
    }
}
