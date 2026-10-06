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
 * The workspaces a server has open. Local mode: the one tree. Hosted mode: a checkout of the
 * repository per user and branch under {@code <data>/workspaces/<user>/<branch>}, cloned on
 * first open, kept while the server runs.
 */
public final class Workspaces {

    private static final Pattern BRANCH = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._/-]*");

    private final Map<String, Workspace> open = new LinkedHashMap<>();
    private final Hosted hosted;     // null in local mode
    private volatile Git git;

    public Workspaces(Hosted hosted, Git git) {
        this.hosted = hosted;
        this.git = git;
    }

    public boolean hosted() {
        return hosted != null;
    }

    /** Hosted mode before setup has chosen a repository. */
    public boolean needsSetup() {
        return hosted != null && hosted.repoUrl == null && hosted.inPlace == null;
    }

    /** Setup chose or made a repository: the git access may have a new token. */
    public synchronized void repositoryChanged(Git newGit) {
        this.git = newGit;
        for (Workspace w : open.values()) {
            w.close();
        }
        open.clear();
    }

    public synchronized Workspace get(String id) {
        return id == null ? null : open.get(id);
    }

    /** Local mode: the tree on the command line, as the only workspace. */
    public synchronized Workspace local(Path tree, Path cases, Path catalog) throws IOException {
        Workspace w = Workspace.open("local", null, tree, tree, cases, catalog);
        open.put(w.id, w);
        return w;
    }

    static String safe(String s) {
        return s.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    /** Hosted mode: the user's checkout of a branch, cloned on first use. */
    public synchronized Workspace openBranch(Session.Principal who, String branch) throws IOException {
        if (branch == null || !BRANCH.matcher(branch).matches() || branch.contains("..")) {
            throw new TreeService.BadRequest("a branch name is letters, digits, '.', '_', '-' and '/'");
        }
        if (needsSetup()) {
            throw new TreeService.BadRequest("no repository yet: choose one in setup");
        }
        if (hosted.inPlace != null) {
            // one checkout used in place, whatever branch it is on
            String id = "in-place";
            Workspace w = open.get(id);
            if (w == null) {
                String current = git.run(hosted.inPlace, "rev-parse", "--abbrev-ref", "HEAD").out.trim();
                w = Workspace.open(id, current.isEmpty() ? "HEAD" : current, hosted.inPlace, hosted.inPlace.resolve(hosted.repoTree).normalize(), hosted.inPlace.resolve(hosted.repoCases).normalize(), hosted.catalog);
                open.put(id, w);
            }
            return w;
        }
        String id = safe(who.subject) + "/" + safe(branch);
        Workspace w = open.get(id);
        if (w != null) {
            return w;
        }
        Path dir = hosted.dataDir.resolve("workspaces").resolve(safe(who.subject)).resolve(safe(branch));
        if (!Files.isDirectory(dir.resolve(".git"))) {
            git.checkout(hosted.repoUrl, branch, hosted.repoBase, dir);
        }
        Path tree = dir.resolve(hosted.repoTree).normalize();
        Path cases = dir.resolve(hosted.repoCases).normalize();
        w = Workspace.open(id, branch, dir, tree, cases, hosted.catalog);
        open.put(id, w);
        return w;
    }

    public synchronized List<Map<String, Object>> describe(Session.Principal who) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Workspace w : open.values()) {
            if (hosted == null || w.id.equals("in-place") || w.id.startsWith(safe(who.subject) + "/")) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", w.id);
                m.put("branch", w.branch);
                m.put("tree", w.tree.toString());
                out.add(m);
            }
        }
        return out;
    }

    public List<String> branches() throws IOException {
        if (hosted == null || needsSetup()) {
            return List.of();
        }
        if (hosted.inPlace != null) {
            List<String> out = new ArrayList<>();
            for (String l : git.run(hosted.inPlace, "branch", "--format=%(refname:short)").out.split("\n")) {
                if (!l.isBlank()) {
                    out.add(l.trim());
                }
            }
            return out;
        }
        return git.remoteBranches(hosted.repoUrl);
    }

    public Hosted config() {
        return hosted;
    }

    public Git git() {
        return git;
    }
}
