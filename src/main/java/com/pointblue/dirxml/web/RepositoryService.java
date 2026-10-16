package com.pointblue.dirxml.web;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * A project's repository (docs/connections-ui.md, The project's repository): where it pushes, and moving a project the
 * server made a repository for (by exporting from a vault, uploading a Designer project…) to a remote of its own:
 * check the remote is empty, list what isn't pushed yet, mirror every branch and tag, verify, then switch the
 * project and every workspace's {@code origin} at once, without a restart, keeping the old repository. Or point a
 * project at a remote that moved. Every step that writes is the deployer's; any failure leaves the project as it was.
 */
public final class RepositoryService {
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneId.systemDefault());

    private final Hosted hosted;
    private final Workspaces workspaces;
    private final Audit audit;

    public RepositoryService(Hosted hosted, Workspaces workspaces, Audit audit) {
        this.hosted = hosted;
        this.workspaces = workspaces;
        this.audit = audit;
    }

    /** The repository a server made for a project, or null when the project is on a remote (or in place). */
    Path serverMade(Project p) {
        if (p.url == null || p.url.contains("://") || p.url.contains("@")) {
            return null;
        }
        Path repo = Path.of(p.url).toAbsolutePath().normalize();
        Path projects = hosted.dataDir.resolve("projects").toAbsolutePath().normalize();
        return repo.startsWith(projects) && Files.isDirectory(repo) ? repo : null;
    }

    /** Where a project pushes, for everyone; never a token. */
    public Map<String, Object> describe(String projectName) throws IOException {
        Project p = workspaces.project(projectName);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("project", p.name);
        m.put("inPlace", p.inPlace != null);
        m.put("serverMade", serverMade(p) != null);
        m.put("pushesTo", serverMade(p) != null ? null : p.shownUrl());
        m.put("base", p.base);
        m.put("tree", p.tree);
        m.put("cases", p.cases);
        m.put("tokenSet", hosted.tokenFor(p) != null);
        m.put("provider", p.provider);
        return m;
    }

    private Git gitWith(String token) throws IOException {
        return new Git(hosted.dataDir, token == null || token.isBlank() ? null : token, hosted.repoSshKey);
    }

    /** ref -> commit for {@code git ls-remote} output or {@code for-each-ref "%(refname) %(objectname)"}. */
    static Map<String, String> refs(String out, boolean lsRemote) {
        Map<String, String> m = new TreeMap<>();
        for (String line : out.split("\n")) {
            String[] p = line.trim().split("\\s+");
            if (p.length < 2) {
                continue;
            }
            String ref = lsRemote ? p[1] : p[0];
            String sha = lsRemote ? p[0] : p[1];
            if ((ref.startsWith("refs/heads/") || ref.startsWith("refs/tags/")) && !ref.endsWith("^{}")) {
                m.put(ref, sha);
            }
        }
        return m;
    }

    private Map<String, String> remoteRefs(Git git, String url) throws IOException {
        Git.Result r = git.run(null, "ls-remote", url);
        if (!r.ok()) {
            String why = (r.err.isBlank() ? r.out : r.err).trim();
            throw new TreeService.BadRequest((why.contains("Authentication failed") || why.contains("403") || why.contains("could not read Username")
                ? "token rejected: the remote refused it (" : "can't reach the remote: ") + why.replaceAll("\\s+", " ") + (why.contains("token rejected") ? ")" : ""));
        }
        return refs(r.out, true);
    }

    private Map<String, String> localRefs(Git git, Path repo) throws IOException {
        Git.Result r = git.run(repo, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/tags");
        if (!r.ok()) {
            throw new IOException("read the server's repository: " + r.err.trim());
        }
        return refs(r.out, false);
    }

    /** Each workspace of the project with commits not pushed or files not committed: who, which branch, how much. */
    List<Map<String, Object>> unpushed(Project p) throws IOException {
        List<Map<String, Object>> out = new ArrayList<>();
        Path root = hosted.dataDir.resolve("workspaces").resolve(Workspaces.safe(p.name));
        if (!Files.isDirectory(root)) {
            return out;
        }
        Git git = workspaces.git();
        try (var people = Files.list(root)) {
            for (Path person : people.sorted().toList()) {
                if (!Files.isDirectory(person)) {
                    continue;
                }
                try (var branches = Files.list(person)) {
                    for (Path w : branches.sorted().toList()) {
                        if (!Files.isDirectory(w.resolve(".git"))) {
                            continue;
                        }
                        String branch = git.run(w, "rev-parse", "--abbrev-ref", "HEAD").out.trim();
                        boolean pushed = git.run(w, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/" + branch).ok();
                        Git.Result c = git.run(w, "rev-list", "--count", (pushed ? "origin/" + branch : "origin/" + p.base) + "..HEAD");
                        int ahead = c.ok() ? Integer.parseInt(c.out.trim().isEmpty() ? "0" : c.out.trim()) : 0;
                        int dirty = 0;
                        for (String l : git.run(w, "status", "--porcelain").out.split("\n")) {
                            if (!l.isBlank()) {
                                dirty++;
                            }
                        }
                        if (ahead > 0 || dirty > 0) {
                            Map<String, Object> m = new LinkedHashMap<>();
                            m.put("person", person.getFileName().toString());
                            m.put("branch", branch);
                            m.put("ahead", ahead);
                            m.put("uncommitted", dirty);
                            m.put("pushed", pushed);
                            out.add(m);
                        }
                    }
                }
            }
        }
        return out;
    }

    /**
     * Can the project move to {@code url}? The remote must be reachable with the token and be empty, or already hold
     * exactly this history. Says what moves: branches, tags, and each workspace's unpushed work.
     */
    public Map<String, Object> check(String projectName, String url, String token) throws IOException {
        Project p = workspaces.project(projectName);
        Path repo = serverMade(p);
        if (repo == null) {
            throw new TreeService.BadRequest(p.name + " already pushes to " + p.shownUrl() + "; use Change remote for a remote that moved");
        }
        String remote = requireUrl(url);
        Map<String, String> theirs = remoteRefs(gitWith(token), remote);
        Map<String, String> ours = localRefs(workspaces.git(), repo);
        boolean empty = theirs.isEmpty();
        boolean same = !empty && ours.entrySet().containsAll(theirs.entrySet());
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", empty || same);
        m.put("empty", empty);
        m.put("sameHistory", same);
        m.put("branches", ours.keySet().stream().filter(r -> r.startsWith("refs/heads/")).count());
        m.put("tags", ours.keySet().stream().filter(r -> r.startsWith("refs/tags/")).count());
        m.put("unpushed", unpushed(p));
        m.put("message", empty ? "The remote is empty: ready to move." : same ? "The remote already holds this project's history: ready to switch."
            : "The remote holds other history (" + theirs.size() + " ref(s) this project doesn't have). Use an empty repository.");
        return m;
    }

    /** Mirror, verify, switch the project and every workspace, keep the old repository. */
    public Map<String, Object> move(Session session, String projectName, String url, String token, String confirm) throws IOException {
        Project p = workspaces.project(projectName);
        if (!p.name.equals(confirm)) {
            throw new TreeService.BadRequest("type the project's name to move it");
        }
        Map<String, Object> checked = check(projectName, url, token);
        if (!Boolean.TRUE.equals(checked.get("ok"))) {
            throw new TreeService.BadRequest(String.valueOf(checked.get("message")));
        }
        Path repo = serverMade(p);
        String remote = requireUrl(url);
        Git git = gitWith(token);
        // 1. every branch and tag, as they are
        Git.Result push = git.run(repo, "push", remote, "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*");
        if (!push.ok()) {
            throw new TreeService.BadRequest("copying the branches failed; nothing was switched: " + (push.err.isBlank() ? push.out : push.err).trim());
        }
        // 2. the remote holds every one of them
        Map<String, String> ours = localRefs(workspaces.git(), repo);
        Map<String, String> theirs = remoteRefs(git, remote);
        for (Map.Entry<String, String> e : ours.entrySet()) {
            if (!e.getValue().equals(theirs.get(e.getKey()))) {
                throw new TreeService.BadRequest("the remote doesn't hold " + e.getKey() + " after the copy; nothing was switched");
            }
        }
        // 3. the project, then each workspace's origin
        int switched = switchTo(p, remote, token);
        // 4. the old repository is kept, renamed
        Path kept = repo.resolveSibling(repo.getFileName() + ".moved-" + STAMP.format(java.time.Instant.now()));
        Files.move(repo, kept);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", true);
        m.put("pushesTo", p.shownUrl());
        m.put("branches", ours.keySet().stream().filter(r -> r.startsWith("refs/heads/")).count());
        m.put("tags", ours.keySet().stream().filter(r -> r.startsWith("refs/tags/")).count());
        m.put("workspaces", switched);
        m.put("kept", kept.toString());
        audit.log(session, null, "project.move-repository", Map.of("project", p.name, "from", repo.toString(), "to", p.shownUrl()), "ok");
        return m;
    }

    /** A project's remote moved (renamed organization, new host): check it holds the base branch, then switch. */
    public Map<String, Object> change(Session session, String projectName, String url, String token, String confirm) throws IOException {
        Project p = workspaces.project(projectName);
        if (!p.name.equals(confirm)) {
            throw new TreeService.BadRequest("type the project's name to change its remote");
        }
        if (serverMade(p) != null) {
            throw new TreeService.BadRequest(p.name + " pushes to a repository on this server; use Push this project to a remote");
        }
        String remote = requireUrl(url);
        String token1 = token == null || token.isBlank() ? hosted.tokenFor(p) : token;
        Map<String, String> theirs = remoteRefs(gitWith(token1), remote);
        if (!theirs.containsKey("refs/heads/" + p.base)) {
            throw new TreeService.BadRequest("the remote has no branch " + p.base + ": is it the same repository?");
        }
        String from = p.shownUrl();
        int switched = switchTo(p, remote, token == null || token.isBlank() ? null : token);
        audit.log(session, null, "project.change-remote", Map.of("project", p.name, "from", String.valueOf(from), "to", p.shownUrl()), "ok");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", true);
        m.put("pushesTo", p.shownUrl());
        m.put("workspaces", switched);
        return m;
    }

    /** The project's remote (and token, when given) saved, its git connection dropped, each workspace's origin repointed. */
    private int switchTo(Project p, String remote, String token) throws IOException {
        p.url = remote;
        if (token != null && !token.isBlank()) {
            p.token = token;
        }
        hosted.saveProject(p);
        workspaces.repositoryChanged(p.name);
        int n = 0;
        Path root = hosted.dataDir.resolve("workspaces").resolve(Workspaces.safe(p.name));
        if (Files.isDirectory(root)) {
            try (var all = Files.walk(root, 2)) {
                for (Path w : all.filter(d -> Files.isDirectory(d.resolve(".git"))).toList()) {
                    if (workspaces.git().run(w, "remote", "set-url", "origin", remote).ok()) {
                        n++;
                    }
                }
            }
        }
        return n;
    }

    private static String requireUrl(String url) {
        if (url == null || url.isBlank()) {
            throw new TreeService.BadRequest("which remote? (https://github.com/org/repo.git, git@host:org/repo.git)");
        }
        String u = url.trim();
        if (u.startsWith("-") || u.contains(" ")) {
            throw new TreeService.BadRequest("not a repository URL: " + u);
        }
        return u;
    }
}
