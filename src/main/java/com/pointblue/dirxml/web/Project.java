package com.pointblue.dirxml.web;

import java.nio.file.Path;

/**
 * One tree a hosted server works on: a repository (cloned per person and branch) or a checkout
 * used in place, where the tree and the simulator corpus sit inside it, and its base branch.
 * A server holds any number, named; the configuration keeps them as {@code project.<name>.*}.
 */
public final class Project {

    public final String name;
    public volatile String url;        // null when inPlace is set
    public volatile Path inPlace;      // a checkout used as the one workspace, or null
    public volatile String tree;       // "." or "tree"
    public volatile String cases;
    public volatile String base;
    public volatile String token;      // for an https remote, or null (the server's repo.token applies)
    public volatile Path sshKey;       // or null (the server's repo.sshKey applies)
    public volatile String provider;   // repo.provider: github | gitlab, or null to infer from the remote (#35)
    public volatile String apiUrl;     // repo.apiUrl: the provider's API, or null for its default
    /** The environments (names from the environments file) this tree is deployed to; empty = every one the file names. */
    public volatile java.util.List<String> environments = java.util.List.of();

    public Project(String name, String url, Path inPlace, String tree, String cases, String base, String token, Path sshKey) {
        this.name = name;
        this.url = url;
        this.inPlace = inPlace;
        this.tree = tree == null || tree.isBlank() ? "." : tree;
        this.cases = cases == null || cases.isBlank() ? "cases" : cases;
        this.base = base == null || base.isBlank() ? "main" : base;
        this.token = token;
        this.sshKey = sshKey;
    }

    /** The remote without any credential it may carry. */
    public String shownUrl() {
        return url == null ? null : url.replaceAll("://[^@/]+@", "://");
    }

    static boolean validName(String s) {
        return s != null && s.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,63}");
    }
}
