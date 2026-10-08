package com.pointblue.dirxml.web;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The workspaces a server has open. Local mode: the one tree. Hosted mode: per project, a
 * checkout of its repository per user and branch under {@code <data>/workspaces/<project>/<user>/<branch>},
 * cloned on first open and kept while the server runs — or the project's checkout used in place.
 */
public final class Workspaces {

    private static final Pattern BRANCH = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._/-]*");

    private final Map<String, Workspace> open = new LinkedHashMap<>();
    /** Who opened each in-place checkout: it is one person's working copy, not a shared workspace (#39). */
    private final Map<String, String> inPlaceOwner = new java.util.HashMap<>();
    private final Hosted hosted;     // null in local mode
    private final Git defaultGit;
    private final Map<String, Git> gits = new LinkedHashMap<>();

    public Workspaces(Hosted hosted, Git git) {
        this.hosted = hosted;
        this.defaultGit = git;
    }

    public boolean hosted() {
        return hosted != null;
    }

    /** Hosted mode with no project yet. */
    public boolean needsSetup() {
        return hosted != null && hosted.projects.isEmpty();
    }

    public synchronized Workspace get(String id) {
        return id == null ? null : open.get(id);
    }

    /** Local mode: the tree on the command line, as the only workspace. */
    public synchronized Workspace local(Path tree, Path cases, Path catalog, EnvFiles files) throws IOException {
        Workspace w = Workspace.open("local", null, tree, tree, cases, catalog, files);
        open.put(w.id, w);
        return w;
    }

    static String safe(String s) {
        return s.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    public Project project(String name) {
        Project p = name == null ? null : hosted.projects.get(name);
        if (p == null) {
            throw new TreeService.BadRequest(name == null || name.isBlank() ? "which project?" : "no project '" + name + "'");
        }
        return p;
    }

    /** The git access for a project: its own token or key when it has one. */
    public synchronized Git gitFor(Project p) throws IOException {
        Git g = gits.get(p.name);
        if (g == null) {
            String token = hosted.tokenFor(p);
            g = token == null && p.sshKey == null ? defaultGit : new Git(hosted.dataDir, token, p.sshKey != null ? p.sshKey : hosted.repoSshKey);
            gits.put(p.name, g);
        }
        return g;
    }

    public Git git() {
        return defaultGit;
    }

    /** A project was added or changed: forget what was open for it. */
    public synchronized void projectChanged(String name) {
        gits.remove(name);
        for (String id : new ArrayList<>(open.keySet())) {
            if (id.startsWith(name + "/")) {
                open.remove(id).close();
            }
        }
    }

    /** Hosted mode: the user's checkout of a project's branch, cloned on first use; or the project's checkout in place. */
    public synchronized Workspace openBranch(Session.Principal who, String projectName, String branch) throws IOException {
        if (needsSetup()) {
            throw new TreeService.BadRequest("no project yet: add one in setup");
        }
        Project p = project(projectName == null || projectName.isBlank() ? hosted.projects.keySet().iterator().next() : projectName);
        Git git = gitFor(p);
        if (p.inPlace != null) {
            String id = p.name + "/in-place";
            String owner = inPlaceOwner.get(id);
            if (owner != null && !owner.equals(who.subject)) {
                throw new TreeService.BadRequest("project '" + p.name + "' is a checkout in place, open by " + owner
                    + "; a checkout in place is one person's working copy — give others a repository to branch from");
            }
            inPlaceOwner.put(id, who.subject);
            Workspace w = open.get(id);
            if (w == null) {
                String current = git.run(p.inPlace, "rev-parse", "--abbrev-ref", "HEAD").out.trim();
                w = Workspace.open(id, current.isEmpty() ? "HEAD" : current, p.inPlace, p.inPlace.resolve(p.tree).normalize(), p.inPlace.resolve(p.cases).normalize(), hosted.catalog, hosted.envFiles(who));

                w.traces = new TraceFiles(hosted.dataDir.resolve("traces").resolve(safe(p.name)));
                w.vault.setEnvironmentFilter(p.environments);
                open.put(id, w);
            }
            return w;
        }
        if (branch == null || !BRANCH.matcher(branch).matches() || branch.contains("..")) {
            throw new TreeService.BadRequest("a branch name is letters, digits, '.', '_', '-' and '/'");
        }
        String id = p.name + "/" + safe(who.subject) + "/" + safe(branch);
        Workspace w = open.get(id);
        if (w != null) {
            return w;
        }
        Path dir = hosted.dataDir.resolve("workspaces").resolve(safe(p.name)).resolve(safe(who.subject)).resolve(safe(branch));
        if (!Files.isDirectory(dir.resolve(".git"))) {
            git.checkout(p.url, branch, p.base, dir);
        }
        w = Workspace.open(id, branch, dir, dir.resolve(p.tree).normalize(), dir.resolve(p.cases).normalize(), hosted.catalog, hosted.envFiles(who));

        w.traces = new TraceFiles(hosted.dataDir.resolve("traces").resolve(safe(p.name)));
        w.vault.setEnvironmentFilter(p.environments);
        open.put(id, w);
        return w;
    }

    /** The project a workspace belongs to (its id's first segment), or null in local mode. */
    public Project projectOf(Workspace w) {
        if (hosted == null || w == null) {
            return null;
        }
        int i = w.id.indexOf('/');
        return i < 0 ? null : hosted.projects.get(w.id.substring(0, i));
    }

    public synchronized List<Map<String, Object>> describe(Session.Principal who) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Workspace w : open.values()) {
            if (hosted == null || (w.id.endsWith("/in-place") && who.subject.equals(inPlaceOwner.get(w.id))) || w.id.contains("/" + safe(who.subject) + "/")) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", w.id);
                Project p = projectOf(w);
                m.put("project", p == null ? null : p.name);
                m.put("branch", w.branch);
                m.put("tree", w.tree.toString());
                out.add(m);
            }
        }
        return out;
    }

    /** Every project with what the page needs to pick one. */
    public List<Map<String, Object>> projects() {
        List<Map<String, Object>> out = new ArrayList<>();
        if (hosted == null) {
            return out;
        }
        for (Project p : hosted.projects.values()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", p.name);
            m.put("repository", p.shownUrl());
            m.put("inPlace", p.inPlace == null ? null : p.inPlace.toString());
            m.put("base", p.base);
            m.put("tree", p.tree);
            out.add(m);
        }
        return out;
    }

    public List<String> branches(String projectName) throws IOException {
        if (hosted == null || needsSetup()) {
            return List.of();
        }
        Project p = project(projectName == null || projectName.isBlank() ? hosted.projects.keySet().iterator().next() : projectName);
        Git git = gitFor(p);
        if (p.inPlace != null) {
            List<String> out = new ArrayList<>();
            for (String l : git.run(p.inPlace, "branch", "--format=%(refname:short)").out.split("\n")) {
                if (!l.isBlank()) {
                    out.add(l.trim());
                }
            }
            return out;
        }
        return git.remoteBranches(p.url);
    }

    public Hosted config() {
        return hosted;
    }
}
