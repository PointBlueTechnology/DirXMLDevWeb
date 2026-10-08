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
    private final EnvFiles files;

    public SetupService(Hosted hosted, Workspaces workspaces, Audit audit, EnvFiles files) {
        this.files = files;
        this.hosted = hosted;
        this.workspaces = workspaces;
        this.audit = audit;
    }

    /** Whether setup is needed (no project yet), and the projects there are. */
    public Map<String, Object> state() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("needed", workspaces.needsSetup());
        m.put("dataDir", hosted.dataDir.toString());
        m.put("projects", workspaces.projects());
        return m;
    }

    private String projectName(String given, String fallback) {
        String n = given == null || given.isBlank() ? fallback : given.trim();
        n = n.replaceAll("[^A-Za-z0-9._-]", "-").replaceAll("^[^A-Za-z0-9]+", "");
        if (n.length() > 64) {
            n = n.substring(0, 64);
        }
        if (!Project.validName(n)) {
            throw new TreeService.BadRequest("a project name is letters, digits, '.', '_' and '-'");
        }
        if (hosted.projects.containsKey(n)) {
            throw new TreeService.BadRequest("a project named '" + n + "' exists already");
        }
        return n;
    }

    /** Forget a project (its workspaces, and a repository the server made for it stay on disk). */
    public Map<String, Object> remove(Session session, String name) throws IOException {
        workspaces.project(name);
        hosted.removeProject(name);
        workspaces.projectChanged(name);
        audit.log(session, null, "project.remove", Map.of("project", name), "ok");
        return Map.of("removed", name);
    }

    private void done(Session session, String how, Map<String, Object> details) {
        audit.log(session, null, "setup." + how, details, "ok");
    }

    /** The driver sets a vault holds, for the person to choose from; the environment's own is marked. */
    public Map<String, Object> driverSets(String envName) throws IOException {
        if (envName == null || envName.isBlank()) {
            throw new TreeService.BadRequest("which environment?");
        }
        Environments.Environment env = files.load().get(envName);
        List<Object> sets = new ArrayList<>();
        try (com.pointblue.dirxml.dev.deploy.Vault v = com.pointblue.dirxml.dev.deploy.Vault.connect(env.vaultConfig())) {
            List<com.pointblue.dirxml.dev.deploy.Vault.Entry> found = new ArrayList<>();
            try {
                found.addAll(v.search("", "(objectClass=DirXML-DriverSet)", javax.naming.directory.SearchControls.SUBTREE_SCOPE));
            } catch (RuntimeException e) {
                // a tree that refuses a search from its root: try each naming context
                for (com.pointblue.dirxml.dev.deploy.Vault.Entry root : v.search("", "(objectClass=*)", javax.naming.directory.SearchControls.OBJECT_SCOPE)) {
                    for (byte[] nc : root.attrs.getOrDefault("namingContexts", List.of())) {
                        try {
                            found.addAll(v.search(new String(nc, java.nio.charset.StandardCharsets.UTF_8), "(objectClass=DirXML-DriverSet)", javax.naming.directory.SearchControls.SUBTREE_SCOPE));
                        } catch (RuntimeException ignore) {
                            // not every context is readable
                        }
                    }
                }
            }
            for (com.pointblue.dirxml.dev.deploy.Vault.Entry e : found) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("dn", e.dn);
                m.put("name", e.dn.replaceFirst("^[^=]+=", "").replaceFirst(",.*$", ""));
                int drivers = 0;
                try {
                    drivers = v.search(e.dn, "(objectClass=DirXML-Driver)", javax.naming.directory.SearchControls.ONELEVEL_SCOPE).size();
                } catch (RuntimeException ignore) {
                    // the count is a courtesy
                }
                m.put("drivers", drivers);
                m.put("default", e.dn.equalsIgnoreCase(env.driverSetDn));
                sets.add(m);
            }
        } catch (RuntimeException e) {
            throw new TreeService.BadRequest("cannot read the vault of '" + envName + "': " + (e.getMessage() == null ? e.toString() : e.getMessage()));
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("environment", envName);
        m.put("configured", env.driverSetDn);
        m.put("driverSets", sets);
        return m;
    }

    /** A tree read from the vault of an environment the Connections view knows: its configured driver set, or another one named. */
    public Map<String, Object> fromVault(Session session, String projectName, String envName, String driverSetDn) throws IOException {
        if (envName == null || envName.isBlank()) {
            throw new TreeService.BadRequest("which environment?");
        }
        Environments.Environment env = files.load().get(envName);
        String dn = driverSetDn == null || driverSetDn.isBlank() ? env.driverSetDn : driverSetDn.trim();
        String setName = dn.replaceFirst("^[^=]+=", "").replaceFirst(",.*$", "");
        String name = projectName(projectName, dn.equalsIgnoreCase(env.driverSetDn) ? envName : envName + "-" + setName);
        List<String> notes = new ArrayList<>();
        DriverSet live = dn.equalsIgnoreCase(env.driverSetDn) ? VaultDiff.readLive(env, notes::add) : VaultDiff.readLive(env.vaultConfig(), dn);
        if (env.secretsFile != null) {
            for (String d : Overrides.stripSecretShimAuthIds(live, Secrets.load(env.secretsFile))) {
                notes.add("'" + d + "'.shim-auth-id kept out of the tree (the secrets file supplies it)");
            }
        }
        Map<String, Object> m = seedRepository(name, live, "Imported from " + envName + " (" + dn + ")");
        m.put("notes", notes);
        m.put("driverSet", dn);
        done(session, "vault", Map.of("project", name, "env", envName, "driverSet", dn, "drivers", live.drivers.size()));
        return m;
    }

    /** A tree read from an uploaded Designer project (a zip of the project directory) or export (an XML file). */
    public Map<String, Object> fromUpload(Session session, String projectName, String kind, String fileName, InputStream body) throws IOException {
        String name = projectName(projectName, fileName == null ? "project" : fileName.replaceAll("\\.(zip|xml)$", ""));
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
            Map<String, Object> m = seedRepository(name, ds, what);
            done(session, kind, Map.of("project", name, "file", String.valueOf(fileName), "drivers", ds.drivers.size()));
            return m;
        } catch (RuntimeException e) {
            throw new TreeService.BadRequest("cannot read that: " + (e.getMessage() == null ? e.toString() : e.getMessage()));
        } finally {
            TreeService.deleteTree(tmp);
        }
    }

    /** A Designer project directory the server can see (the single-user layout mounts the person's files). */
    public Map<String, Object> fromProjectPath(Session session, String projectName, String path) throws IOException {
        Path p = existingDir(path);
        String name = projectName(projectName, p.getFileName().toString());
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
        Map<String, Object> m = seedRepository(name, ds, "Imported from the Designer project " + project.getFileName());
        done(session, "project", Map.of("project", name, "path", project.toString(), "drivers", ds.drivers.size()));
        return m;
    }

    /** A repository already on this host: bare (cloned per branch, as a remote would be) or a checkout (used in place). */
    public Map<String, Object> existingRepository(Session session, String projectName, String path) throws IOException {
        Path p = existingDir(path);
        String name = projectName(projectName, p.getFileName().toString().replaceAll("\\.git$", ""));
        Git git = workspaces.git();
        boolean bare = "true".equals(git.run(p, "rev-parse", "--is-bare-repository").out.trim());
        boolean checkout = Files.isDirectory(p.resolve(".git"));
        if (!bare && !checkout) {
            throw new TreeService.BadRequest(path + " is not a git repository (neither bare nor a checkout); 'Use a directory of files' is for a plain tree");
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("project", name);
        if (bare) {
            String tree = treeIn(p, null);
            hosted.saveProject(new Project(name, p.toString(), null, tree, "cases", defaultBranch(p), null, null));
            m.put("repository", p.toString());
            m.put("tree", tree);
        } else {
            String tree = treeIn(null, p);
            hosted.saveProject(new Project(name, null, p, tree, "cases", git.run(p, "rev-parse", "--abbrev-ref", "HEAD").out.trim(), null, null));
            m.put("inPlace", p.toString());
            m.put("tree", tree);
        }
        workspaces.projectChanged(name);
        done(session, "existing", Map.of("project", name, "path", p.toString(), "bare", bare));
        return m;
    }

    /** A plain directory holding a tree (or tree/ and cases/): made into a repository in place, then used in place. */
    public Map<String, Object> fromDirectory(Session session, String projectName, String path) throws IOException {
        Path p = existingDir(path);
        if (Files.isDirectory(p.resolve(".git"))) {
            return existingRepository(session, projectName, path);
        }
        String name = projectName(projectName, p.getFileName().toString());
        String tree = treeIn(null, p);
        Git git = workspaces.git();
        Git.Result r = git.run(p, "init", "-q", "-b", "main");
        if (!r.ok()) {
            throw new TreeService.BadRequest("git init in " + p + ": " + r.err.trim());
        }
        Files.writeString(p.resolve(".gitignore"), "deploy-snapshots/\n.dirxmldev/\n", StandardCharsets.UTF_8);
        git.run(p, "add", "-A");
        git.run(p, "-c", "user.name=DirXMLDevWeb", "-c", "user.email=idmweb@localhost", "commit", "-q", "-m", "Initial tree");
        hosted.saveProject(new Project(name, null, p, tree, "cases", "main", null, null));
        workspaces.projectChanged(name);
        done(session, "directory", Map.of("project", name, "path", p.toString()));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("project", name);
        m.put("inPlace", p.toString());
        m.put("tree", tree);
        return m;
    }

    /** A remote to clone, with a token for an https remote if it needs one. */
    public Map<String, Object> cloneRemote(Session session, String projectName, String url, String token, String base) throws IOException {
        if (url == null || url.isBlank()) {
            throw new TreeService.BadRequest("which repository?");
        }
        url = url.trim();
        String name = projectName(projectName, url.replaceAll("[/\\\\]+$", "").replaceAll(".*[/:]", "").replaceAll("\\.git$", ""));
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
        hosted.saveProject(new Project(name, url, null, tree, "cases", b, token == null || token.isBlank() ? null : token, null));
        workspaces.projectChanged(name);
        done(session, "clone", Map.of("project", name, "url", url.replaceAll("://[^@/]+@", "://"), "base", b));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("project", name);
        m.put("repository", url.replaceAll("://[^@/]+@", "://"));
        m.put("base", b);
        m.put("tree", tree);
        m.put("branches", heads);
        return m;
    }

    // ---- helpers ------------------------------------------------------------------------------

    /** Write the tree into data/projects/<name>.git (main: tree/, cases/) and add the project. */
    private Map<String, Object> seedRepository(String name, DriverSet ds, String message) throws IOException {
        Path repo = hosted.dataDir.resolve("projects").resolve(name + ".git");
        if (Files.exists(repo)) {
            throw new TreeService.BadRequest(repo + " exists already; choose 'an existing repository' for it, or another name");
        }
        Files.createDirectories(repo.getParent());
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
        hosted.saveProject(new Project(name, repo.toString(), null, "tree", "cases", "main", null, null));
        workspaces.projectChanged(name);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("project", name);
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

    private Path existingDir(String path) {
        if (path == null || path.isBlank()) {
            throw new TreeService.BadRequest("which directory?");
        }
        Path p = Path.of(path.trim()).toAbsolutePath().normalize();
        // only under the configured roots: the server must not attach or initialise arbitrary host paths (#41)
        if (hosted.setupRoots.stream().noneMatch(p::startsWith)) {
            throw new TreeService.BadRequest(p + " is outside the directories this server may attach (setup.roots: " + hosted.setupRoots + ")");
        }
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
