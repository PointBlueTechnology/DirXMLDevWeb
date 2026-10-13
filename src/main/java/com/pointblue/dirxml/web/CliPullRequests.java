package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.json.Json;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Pull requests on a local install (#35 P3, docs/pull-requests.md §4) through the provider's own CLI, signed in
 * as the person already: {@code gh} for GitHub, {@code glab} for GitLab. Nothing is stored; the CLI keeps its own
 * sign-in. Runs in the checkout, so the CLI finds the repository from its remote, with prompts disabled.
 */
final class CliPullRequests {

    private final String gh;
    private final String glab;

    CliPullRequests(String gh, String glab) {
        this.gh = gh;
        this.glab = glab;
    }

    /** {@code gh} and {@code glab} from PATH or the usual install places; null for one that is not there. */
    static CliPullRequests find() {
        return new CliPullRequests(locate("gh"), locate("glab"));
    }

    static String locate(String name) {
        List<String> dirs = new ArrayList<>();
        String path = System.getenv("PATH");
        if (path != null) {
            dirs.addAll(List.of(path.split(java.io.File.pathSeparator)));
        }
        // a server started from a desktop launcher may not have Homebrew's directory on its PATH
        dirs.addAll(List.of("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/home/linuxbrew/.linuxbrew/bin"));
        for (String d : dirs) {
            if (d.isBlank()) {
                continue;
            }
            Path p = Path.of(d, name);
            if (Files.isExecutable(p)) {
                return p.toString();
            }
        }
        return null;
    }

    /** The CLI for a provider ("gh", "glab"), as named on the page. */
    static String cliName(PullRequests.Provider p) {
        return p == PullRequests.Provider.GITHUB ? "gh" : "glab";
    }

    String executable(PullRequests.Provider p) {
        return p == PullRequests.Provider.GITHUB ? gh : glab;
    }

    /** The account the CLI is signed in to {@code t}'s host as, or null when it is not signed in there. */
    String account(PullRequests.Target t, Path repo) throws IOException {
        String exe = executable(t.provider());
        if (exe == null) {
            return null;
        }
        Run status = run(repo, exe, "auth", "status", "--hostname", t.host());
        if (status.code != 0) {
            return null;
        }
        if (t.provider() == PullRequests.Provider.GITHUB) {
            Run u = run(repo, exe, "api", "--hostname", t.host(), "user", "--jq", ".login");
            return u.code == 0 && !u.out.isBlank() ? u.out.strip() : "your " + t.host() + " account";
        }
        Run u = run(repo, exe, "api", "--hostname", t.host(), "user");
        if (u.code == 0) {
            try {
                String name = Json.asString(Json.asMap(Json.parse(u.out)).get("username"));
                if (name != null) {
                    return name;
                }
            } catch (RuntimeException ignore) {
                // fall through
            }
        }
        return "your " + t.host() + " account";
    }

    /** The branch's open request, the same shape as {@link PullRequests#request}, or null. */
    Map<String, Object> findOpen(PullRequests.Target t, Path repo, String branch) throws IOException {
        Run r;
        if (t.provider() == PullRequests.Provider.GITHUB) {
            r = must(t, run(repo, gh, "pr", "list", "--head", branch, "--state", "open", "--json", "number,url,state,title,isDraft", "--limit", "1"));
        } else {
            r = must(t, run(repo, glab, "mr", "list", "--source-branch", branch, "--output", "json"));
        }
        Object parsed;
        try {
            parsed = r.out.isBlank() ? List.of() : Json.parse(r.out);
        } catch (RuntimeException e) {
            throw new PullRequests.ProviderError(cliName(t.provider()) + " answered something that is not JSON: " + r.out.strip(), 0);
        }
        List<Object> list = Json.asList(parsed);
        if (list == null || list.isEmpty()) {
            return null;
        }
        Map<String, Object> o = Json.asMap(list.get(0));
        if (t.provider() == PullRequests.Provider.GITHUB) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("provider", t.provider().label);
            m.put("number", o.get("number"));
            m.put("url", Json.asString(o.get("url")));
            m.put("state", Json.asString(o.get("state")) == null ? null : Json.asString(o.get("state")).toLowerCase(java.util.Locale.ROOT));
            m.put("title", Json.asString(o.get("title")));
            m.put("draft", Boolean.TRUE.equals(o.get("isDraft")));
            return m;
        }
        return PullRequests.request(t, o);
    }

    /** Creates the request with the CLI, then reads it back as {@link #findOpen} gives it. */
    Map<String, Object> create(PullRequests.Target t, Path repo, String base, String branch, String title, String body, boolean draft) throws IOException {
        List<String> cmd = new ArrayList<>();
        if (t.provider() == PullRequests.Provider.GITHUB) {
            cmd.addAll(List.of(gh, "pr", "create", "--base", base, "--head", branch, "--title", title, "--body", body));
        } else {
            cmd.addAll(List.of(glab, "mr", "create", "--source-branch", branch, "--target-branch", base, "--title", title, "--description", body, "--yes"));
        }
        if (draft) {
            cmd.add("--draft");
        }
        Run created = must(t, run(repo, cmd.toArray(new String[0])));
        Map<String, Object> found = findOpen(t, repo, branch);
        if (found != null) {
            return found;
        }
        // created but not listed yet: the CLI printed its URL
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("provider", t.provider().label);
        String url = created.out.strip().replaceAll("(?s).*?(https?://\\S+)\\s*$", "$1");
        m.put("url", url);
        String n = url.replaceAll(".*/(\\d+)$", "$1");
        m.put("number", n.matches("\\d+") ? Integer.parseInt(n) : null);
        m.put("state", "open");
        m.put("title", title);
        m.put("draft", draft);
        return m;
    }

    private static Run must(PullRequests.Target t, Run r) {
        if (r.code != 0) {
            String why = (r.err.isBlank() ? r.out : r.err).strip();
            throw new PullRequests.ProviderError(cliName(t.provider()) + ": " + (why.isEmpty() ? "exit " + r.code : why), 0);
        }
        return r;
    }

    record Run(int code, String out, String err) {
    }

    static Run run(Path dir, String... cmd) throws IOException {
        ProcessBuilder pb = new ProcessBuilder(cmd);
        if (dir != null) {
            pb.directory(dir.toFile());
        }
        Map<String, String> env = pb.environment();
        env.put("GH_PROMPT_DISABLED", "1");
        env.put("GH_NO_UPDATE_NOTIFIER", "1");
        env.put("GLAB_CHECK_UPDATE", "false");
        env.put("NO_PROMPT", "1");
        env.put("NO_COLOR", "1");
        env.put("PAGER", "cat");
        env.put("GH_PAGER", "cat");
        Process p = pb.start();
        p.getOutputStream().close();
        try {
            java.util.concurrent.CompletableFuture<String> out = java.util.concurrent.CompletableFuture.supplyAsync(() -> read(p.getInputStream()));
            java.util.concurrent.CompletableFuture<String> err = java.util.concurrent.CompletableFuture.supplyAsync(() -> read(p.getErrorStream()));
            if (!p.waitFor(60, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                throw new IOException(cmd[0] + " took longer than 60 s");
            }
            return new Run(p.exitValue(), out.join(), err.join());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            p.destroyForcibly();
            throw new IOException("interrupted running " + cmd[0]);
        }
    }

    private static String read(java.io.InputStream in) {
        try {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "";
        }
    }
}
