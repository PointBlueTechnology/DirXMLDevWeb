package com.pointblue.dirxml.web;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The repository side of a workspace, through the host's own {@code git}. A token for an HTTPS
 * remote reaches git through {@code GIT_ASKPASS} and the environment of the git process only;
 * no URL, file or log carries it.
 */
public final class Git {

    public static final class Result {
        public final int status;
        public final String out;
        public final String err;

        Result(int status, String out, String err) {
            this.status = status;
            this.out = out;
            this.err = err;
        }

        public boolean ok() {
            return status == 0;
        }
    }

    private final Path askpass;     // null without a token
    private final String token;
    private final Path sshKey;      // an SSH deploy key for a git@ remote, or null
    private final Path knownHosts;

    public Git(Path dataDir, String token) throws IOException {
        this(dataDir, token, null);
    }

    public Git(Path dataDir, String token, Path sshKey) throws IOException {
        this.sshKey = sshKey;
        this.knownHosts = dataDir == null ? null : dataDir.resolve("known_hosts");
        this.token = token == null || token.isBlank() ? null : token;
        if (this.token == null || dataDir == null) {
            this.askpass = null;
        } else {
            Files.createDirectories(dataDir);
            askpass = dataDir.resolve("git-askpass.sh");
            Files.writeString(askpass, "#!/bin/sh\n# prints the token DirXMLDevWeb put in the environment of this git process\ncase \"$1\" in\n  *sername*) echo \"${IDMWEB_GIT_USER:-token}\" ;;\n  *) echo \"$IDMWEB_GIT_TOKEN\" ;;\nesac\n", StandardCharsets.UTF_8);
            try {
                Files.setPosixFilePermissions(askpass, PosixFilePermissions.fromString("rwx------"));
            } catch (UnsupportedOperationException e) {
                // not POSIX
            }
        }
    }

    public Result run(Path dir, String... args) throws IOException {
        List<String> cmd = new ArrayList<>();
        cmd.add("git");
        cmd.addAll(List.of(args));
        ProcessBuilder pb = new ProcessBuilder(cmd).directory(dir == null ? null : dir.toFile());
        Map<String, String> env = pb.environment();
        env.put("GIT_TERMINAL_PROMPT", "0");
        env.put("LC_ALL", "C");
        if (askpass != null) {
            env.put("GIT_ASKPASS", askpass.toString());
            env.put("IDMWEB_GIT_TOKEN", token);
        }
        if (sshKey != null) {
            // the deploy key, and a known_hosts of our own that learns a host on first contact
            env.put("GIT_SSH_COMMAND", "ssh -i " + sshKey + " -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=" + knownHosts + " -o BatchMode=yes");
        }
        try {
            Process p = pb.start();
            byte[] out = p.getInputStream().readAllBytes();
            byte[] err = p.getErrorStream().readAllBytes();
            int status = p.waitFor();
            return new Result(status, new String(out, StandardCharsets.UTF_8), scrub(new String(err, StandardCharsets.UTF_8)));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("interrupted");
        }
    }

    private String scrub(String s) {
        return token == null ? s : s.replace(token, "•••");
    }

    private static Result must(Result r, String what) {
        if (!r.ok()) {
            throw new TreeService.BadRequest(what + ": " + (r.err.isBlank() ? r.out : r.err).trim());
        }
        return r;
    }

    /** Clone {@code branch} of {@code url} into {@code dir}; a branch the remote lacks is made from {@code base}. Returns whether it was created. */
    public boolean checkout(String url, String branch, String base, Path dir) throws IOException {
        Files.createDirectories(dir.getParent());
        Result r = run(null, "clone", "--branch", branch, "--single-branch", url, dir.toString());
        if (r.ok()) {
            trackOwnBranch(dir, branch);
            return false;
        }
        must(run(null, "clone", "--branch", base, "--single-branch", url, dir.toString()), "clone " + base);
        must(run(dir, "checkout", "-b", branch), "create branch " + branch);
        trackOwnBranch(dir, branch);
        return true;
    }

    /**
     * A single-branch clone's origin tracks only the branch it was cloned from, so a push of the workspace's own
     * branch would leave no {@code origin/<branch>}: no "to push" count, and no telling whether a pull request
     * would show the latest commit (#35). Track it.
     */
    void trackOwnBranch(Path dir, String branch) throws IOException {
        if (branch == null || branch.isBlank() || branch.equals("HEAD")) {
            return;
        }
        String spec = "+refs/heads/" + branch + ":refs/remotes/origin/" + branch;
        Result have = run(dir, "config", "--get-all", "remote.origin.fetch");
        if (have.ok() && java.util.Arrays.asList(have.out.split("\n")).contains(spec)) {
            return;
        }
        if (!have.ok() || have.out.isBlank() || have.out.contains("refs/heads/*:")) {
            return; // no origin, or it already tracks every branch
        }
        run(dir, "config", "--add", "remote.origin.fetch", spec);
    }

    public Map<String, Object> status(Path dir, String base) throws IOException {
        Map<String, Object> m = new LinkedHashMap<>();
        Result inside = run(dir, "rev-parse", "--show-toplevel");
        if (!inside.ok()) {
            m.put("repository", false);
            return m;
        }
        m.put("repository", true);
        m.put("top", inside.out.trim());
        m.put("branch", run(dir, "rev-parse", "--abbrev-ref", "HEAD").out.trim());
        List<Object> changed = new ArrayList<>();
        for (String line : must(run(dir, "status", "--porcelain=v1", "--untracked-files=all"), "status").out.split("\n")) {
            if (line.length() > 3) {
                Map<String, Object> c = new LinkedHashMap<>();
                c.put("status", line.substring(0, 2).trim());
                c.put("file", line.substring(3).trim());
                changed.add(c);
            }
        }
        m.put("changed", changed);
        Result last = run(dir, "log", "-1", "--format=%h%x09%an%x09%ar%x09%s");
        if (last.ok() && !last.out.isBlank()) {
            String[] p = last.out.trim().split("\t", 4);
            Map<String, Object> l = new LinkedHashMap<>();
            l.put("hash", p[0]);
            l.put("author", p.length > 1 ? p[1] : "");
            l.put("when", p.length > 2 ? p[2] : "");
            l.put("subject", p.length > 3 ? p[3] : "");
            m.put("last", l);
        }
        Result upstream = run(dir, "rev-parse", "--abbrev-ref", "@{upstream}");
        m.put("upstream", upstream.ok() ? upstream.out.trim() : null);
        if (upstream.ok()) {
            Result ab = run(dir, "rev-list", "--left-right", "--count", "HEAD...@{upstream}");
            if (ab.ok()) {
                String[] p = ab.out.trim().split("\\s+");
                m.put("ahead", Integer.parseInt(p[0]));
                m.put("behind", p.length > 1 ? Integer.parseInt(p[1]) : 0);
            }
        }
        Result remote = run(dir, "remote", "get-url", "origin");
        m.put("remote", remote.ok() ? remote.out.trim().replaceAll("://[^@/]+@", "://") : null);
        m.put("base", base);
        m.put("compareUrl", compareUrl(remote.ok() ? remote.out.trim() : null, base, (String) m.get("branch")));
        return m;
    }

    /** The provider's compare page for a pull request, for the remotes we know the shape of. */
    static String compareUrl(String remote, String base, String branch) {
        if (remote == null || base == null || branch == null || base.equals(branch)) {
            return null;
        }
        String web = remote.replaceAll("://[^@/]+@", "://").replaceAll("\\.git$", "");
        if (web.startsWith("git@")) {
            web = "https://" + web.substring(4).replaceFirst(":", "/");
        }
        if (web.contains("github.com")) {
            return web + "/compare/" + base + "..." + branch + "?expand=1";
        }
        if (web.contains("gitlab")) {
            return web + "/-/merge_requests/new?merge_request[source_branch]=" + branch + "&merge_request[target_branch]=" + base;
        }
        return null;
    }

    public Map<String, Object> commit(Path dir, String message, String authorName, String authorEmail, boolean push) throws IOException {
        if (message == null || message.isBlank()) {
            throw new TreeService.BadRequest("a commit needs a message");
        }
        must(run(dir, "add", "-A"), "stage");
        List<String> args = new ArrayList<>(List.of("-c", "user.name=" + (authorName == null ? "DirXMLDevWeb" : authorName), "-c", "user.email=" + (authorEmail == null ? "idmweb@localhost" : authorEmail), "commit", "-m", message));
        Result c = run(dir, args.toArray(new String[0]));
        Map<String, Object> m = new LinkedHashMap<>();
        if (!c.ok()) {
            if (c.out.contains("nothing to commit") || c.err.contains("nothing to commit")) {
                m.put("committed", false);
                m.put("message", "nothing to commit");
            } else {
                throw new TreeService.BadRequest("commit: " + (c.err.isBlank() ? c.out : c.err).trim());
            }
        } else {
            m.put("committed", true);
            m.put("hash", run(dir, "rev-parse", "--short", "HEAD").out.trim());
        }
        if (push) {
            String branch = run(dir, "rev-parse", "--abbrev-ref", "HEAD").out.trim();
            trackOwnBranch(dir, branch);
            Result p = run(dir, "push", "-u", "origin", branch);
            m.put("pushed", p.ok());
            if (!p.ok()) {
                throw new TreeService.BadRequest("push: " + p.err.trim());
            }
        }
        return m;
    }

    /**
     * What differs between the working tree and {@code ref} ({@code HEAD}: everything uncommitted;
     * {@code origin/main}: the branch and its uncommitted work against the remote base; {@code @{upstream}}:
     * against what was pushed), as each changed file's two sides. Binary and very large files come
     * without contents. Limited to {@code max} files.
     */
    public List<Map<String, Object>> diff(Path dir, String ref, int max) throws IOException {
        List<Map<String, Object>> out = new ArrayList<>();
        Result names = run(dir, "diff", "--name-status", "--find-renames", ref, "--");
        if (!names.ok()) {
            throw new TreeService.BadRequest("git diff " + ref + ": " + names.err.trim());
        }
        List<String[]> entries = new ArrayList<>();
        for (String line : names.out.split("\n")) {
            if (line.isBlank()) {
                continue;
            }
            String[] p = line.split("\t");
            String status = p[0].substring(0, 1);
            String file = p[p.length - 1];
            String from = status.equals("R") && p.length > 2 ? p[1] : file;
            entries.add(new String[] {status, file, from});
        }
        // untracked files are differences too
        for (String line : run(dir, "ls-files", "--others", "--exclude-standard").out.split("\n")) {
            if (!line.isBlank()) {
                entries.add(new String[] {"?", line.trim(), line.trim()});
            }
        }
        for (String[] e : entries) {
            if (out.size() >= max) {
                Map<String, Object> more = new LinkedHashMap<>();
                more.put("file", "… and " + (entries.size() - max) + " more");
                more.put("status", "");
                out.add(more);
                break;
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("file", e[1]);
            m.put("status", switch (e[0]) { case "A", "?" -> "added"; case "D" -> "deleted"; case "R" -> "renamed"; default -> "changed"; });
            m.put("from", e[2].equals(e[1]) ? null : e[2]);
            m.put("language", TreeService.language(e[1]));
            String before = e[0].equals("A") || e[0].equals("?") ? "" : show(dir, ref, e[2]);
            Path after = dir.resolve(e[1]);
            String now = e[0].equals("D") || !Files.isRegularFile(after) ? "" : text(after);
            m.put("before", before);
            m.put("after", now);
            out.add(m);
        }
        return out;
    }

    private String show(Path dir, String ref, String file) throws IOException {
        Result r = run(dir, "show", ref + ":" + file);
        if (!r.ok()) {
            return "";
        }
        return r.out.length() > 2_000_000 ? "(too large to show)" : r.out;
    }

    private static String text(Path f) throws IOException {
        if (Files.size(f) > 2_000_000) {
            return "(too large to show)";
        }
        byte[] b = Files.readAllBytes(f);
        for (int i = 0; i < Math.min(b.length, 8000); i++) {
            if (b[i] == 0) {
                return "(binary)";
            }
        }
        return new String(b, StandardCharsets.UTF_8);
    }

    /** Bring the base branch's latest into this one; a conflict is reported with its files and left as is. */
    public Map<String, Object> update(Path dir, String base) throws IOException {
        must(run(dir, "fetch", "origin", base), "fetch");
        Result merge = run(dir, "merge", "--no-edit", "origin/" + base);
        Map<String, Object> m = new LinkedHashMap<>();
        if (merge.ok()) {
            m.put("merged", true);
            m.put("message", merge.out.trim().isEmpty() ? "up to date" : merge.out.trim().split("\n")[0]);
            return m;
        }
        List<String> conflicts = new ArrayList<>();
        for (String line : run(dir, "diff", "--name-only", "--diff-filter=U").out.split("\n")) {
            if (!line.isBlank()) {
                conflicts.add(line.trim());
            }
        }
        run(dir, "merge", "--abort");
        m.put("merged", false);
        m.put("conflicts", conflicts);
        m.put("message", "merging origin/" + base + " conflicts in " + conflicts.size() + " file(s); the merge was abandoned, resolve it in a checkout");
        return m;
    }

    /** Merge a local branch (a captured as-found state) into the current one; on conflicts the merge is abandoned and they are listed. */
    public Map<String, Object> mergeLocal(Path dir, String branch) throws IOException {
        must(run(dir, "rev-parse", "--verify", "--quiet", "refs/heads/" + branch), "find branch " + branch);
        Result merge = run(dir, "merge", "--no-edit", "-m", "Take the vault's captured state (" + branch + ")", branch);
        Map<String, Object> m = new LinkedHashMap<>();
        if (merge.ok()) {
            m.put("merged", true);
            m.put("message", merge.out.trim().isEmpty() ? "up to date" : merge.out.trim().split("\n")[0]);
            return m;
        }
        List<String> conflicts = new ArrayList<>();
        for (String line : run(dir, "diff", "--name-only", "--diff-filter=U").out.split("\n")) {
            if (!line.isBlank()) {
                conflicts.add(line.trim());
            }
        }
        run(dir, "merge", "--abort");
        m.put("merged", false);
        m.put("conflicts", conflicts);
        m.put("message", "merging " + branch + " conflicts in " + conflicts.size() + " file(s); the merge was abandoned, resolve it in a checkout");
        return m;
    }

    public List<String> remoteBranches(String url) throws IOException {
        List<String> out = new ArrayList<>();
        Result r = must(run(null, "ls-remote", "--heads", url), "list branches");
        for (String line : r.out.split("\n")) {
            int i = line.indexOf("refs/heads/");
            if (i > 0) {
                out.add(line.substring(i + "refs/heads/".length()).trim());
            }
        }
        return out;
    }
}
